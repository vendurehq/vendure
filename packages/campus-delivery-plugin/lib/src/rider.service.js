"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiderService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const rider_ops_service_1 = require("./rider-ops.service");
const feishu_config_1 = require("./feishu/feishu.config");
const rider_compliance_1 = require("./rider-compliance");
const CREDIT_LIMIT = 60;
let RiderService = class RiderService {
    constructor(connection, customerService, riderOps, 
    /** 骑手飞书应用凭证：绑定未显式传 appId 时取环境变量里的骑手应用 appId */
    feishuConfig) {
        this.connection = connection;
        this.customerService = customerService;
        this.riderOps = riderOps;
        this.feishuConfig = feishuConfig;
    }
    /** 当前登录顾客；未登录或无对应顾客一律 ForbiddenError。 */
    async requireCustomer(ctx) {
        if (!ctx.activeUserId) {
            throw new core_1.ForbiddenError();
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            throw new core_1.ForbiddenError();
        }
        return customer;
    }
    async applyRider(ctx, input) {
        var _a, _b, _c, _d, _e;
        const customer = await this.requireCustomer(ctx);
        const realName = String((_a = input.realName) !== null && _a !== void 0 ? _a : '').trim();
        const studentNo = String((_b = input.studentNo) !== null && _b !== void 0 ? _b : '').trim();
        const campus = String((_c = input.campus) !== null && _c !== void 0 ? _c : '').trim();
        const idImg = input.idImg == null ? null : String(input.idImg).trim();
        const healthCertImg = input.healthCertImg == null ? null : String(input.healthCertImg).trim();
        if (!realName || !studentNo || !campus) {
            throw new core_1.UserInputError('请填写姓名、学号和校区');
        }
        // 入参上限：防超长文本写库（字段无长度约束，前端也校验）
        if ([realName, studentNo, campus].some(v => v.length > 30)) {
            throw new core_1.UserInputError('姓名、学号、校区均不能超过 30 个字符');
        }
        if (idImg && idImg.length > 500) {
            throw new core_1.UserInputError('证件图片地址不合法');
        }
        if (healthCertImg && healthCertImg.length > 500) {
            throw new core_1.UserInputError('健康证图片地址不合法');
        }
        const current = String((_e = (_d = customer.customFields) === null || _d === void 0 ? void 0 : _d.riderStatus) !== null && _e !== void 0 ? _e : 'none');
        // 已停用账号不得自助复申请（否则改回 pending 可绕过停用）；
        // 已通过审核者仅更新资料，保留 approved（重新提交不能把在职骑手打回待审）
        if (current === 'suspended')
            throw new core_1.UserInputError('骑手账号已停用，请联系管理员');
        const status = current === 'approved' ? 'approved' : 'pending';
        await this.connection.getRepository(ctx, core_1.Customer).update(customer.id, {
            customFields: Object.assign({ riderStatus: status, riderRealName: realName, riderStudentNo: studentNo, riderCampus: campus, riderIdImg: idImg }, (healthCertImg ? { riderHealthCertImg: healthCertImg } : {})),
        });
        return { status };
    }
    /** 骑手归属渠守卫：Customer 的渠道是多对多，必须 join customer.channels。
     * 否则 A 店审核员可按 customerId 查看/停用 B 店骑手（含学号、证件照）。 */
    async assertCustomerInChannel(ctx, customerId) {
        const inChannel = await this.connection
            .getRepository(ctx, core_1.Customer)
            .createQueryBuilder('customer')
            .leftJoin('customer.channels', 'channel')
            .where('customer.id = :id', { id: customerId })
            .andWhere('channel.id = :ch', { ch: ctx.channelId })
            .getOne();
        if (!inChannel)
            throw new core_1.UserInputError('骑手不存在或不属于当前店铺');
    }
    async setRiderStatus(ctx, customerId, status) {
        if (!['none', 'approved', 'suspended'].includes(String(status !== null && status !== void 0 ? status : ''))) {
            throw new core_1.UserInputError('骑手状态不合法');
        }
        await this.assertCustomerInChannel(ctx, customerId);
        const customFields = { riderStatus: status };
        // 停用/重置即强制下线：否则残留的心跳时间仍让对方出现在在线运力池里被派单
        if (status !== 'approved')
            customFields.riderOnlineAt = null;
        await this.connection.getRepository(ctx, core_1.Customer).update(customerId, {
            customFields,
        });
        // 停用/重置必须回收在途任务：否则已停用骑手名下的 assigned/in_progress 单会卡死，
        // 只能靠运营手工回厅。复用回厅语义（活跃态→open、清骑手指派字段、不复活已取消/终态单）。
        if (status !== 'approved')
            await this.reclaimActiveTasks(customerId);
        return { status };
    }
    /** 回收某骑手名下在途任务回大厅（单条条件写，避免逐单先读后写）。
     *  仅活跃流转态 + 仍指派本人 + 未取消的单被重置；已送达/异常终态不受影响。 */
    async reclaimActiveTasks(customerId) {
        const ACTIVE_HALL_STATUSES = [
            'open', 'pending_merchant', 'accepted', 'scheduled', 'grabbed', 'third_party',
            'merchant_delivering', 'owned_pool', 'owned_dispatched', 'pending_dispatch',
        ];
        const out = await this.connection.rawConnection.query('UPDATE "order" SET "customFieldsHallstatus" = $1, "customFieldsDeliverystaffid" = NULL, '
            + '"customFieldsDeliverystatus" = NULL, "customFieldsAssignedat" = NULL '
            + 'WHERE "customFieldsDeliverystaffid" = $2 AND "customFieldsDeliverystatus" = ANY($3::text[]) '
            + 'AND COALESCE("customFieldsHallstatus", \'\') = ANY($4::text[]) AND "state" <> \'Cancelled\' '
            + 'RETURNING id', ['open', String(customerId), ['assigned', 'in_progress'], ACTIVE_HALL_STATUSES]);
        const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
        return Array.isArray(rows) ? rows.length : 0;
    }
    /** 飞书 open_id → 骑手 Customer。open_id 是应用维度的，必须与骑手应用的 appId 一起匹配：
     * 缺 appId（历史 A 方案绑定）或来自其他应用的一律视为失效，提示运营重绑，绝不静默当成有效。 */
    async resolveFeishuRider(openId, appId) {
        const id = String(openId !== null && openId !== void 0 ? openId : '').trim();
        if (!id)
            return { kind: 'unbound' };
        const app = String(appId !== null && appId !== void 0 ? appId : '').trim();
        const rows = await this.connection.rawConnection.getRepository(core_1.Customer)
            .createQueryBuilder('customer')
            .leftJoinAndSelect('customer.user', 'user')
            .where('customer.customFields.riderFeishuOpenId = :openId', { openId: id })
            .getMany();
        if (!rows.length)
            return { kind: 'unbound' };
        const matched = rows.filter(r => { var _a, _b; return String((_b = (_a = r.customFields) === null || _a === void 0 ? void 0 : _a.riderFeishuAppId) !== null && _b !== void 0 ? _b : '').trim() === app; });
        // 有 open_id 绑定但没有一条带当前骑手应用标识：旧绑定已失效，必须重绑
        if (!app || !matched.length)
            return { kind: 'legacyBinding' };
        // 唯一性在绑定时已校验；历史脏数据/并发写入导致的重复绑定按冲突处理，不猜其中一人
        if (matched.length > 1)
            return { kind: 'conflict' };
        const customer = matched[0];
        const cf = customer.customFields;
        if (cf.riderStatus !== 'approved')
            return { kind: 'notApproved', customer };
        return { kind: 'ok', customer };
    }
    /** 运营绑定/解绑骑手飞书身份：openId 为空即解绑（可反复重绑，不是一次性绑定）。
     * appId 缺省取环境变量 FEISHU_RIDER_APP_ID，确保「应用 + open_id」成对落库。 */
    async setFeishuBinding(ctx, customerId, openId, appId) {
        var _a, _b;
        await this.assertCustomerInChannel(ctx, customerId);
        const repo = this.connection.getRepository(ctx, core_1.Customer);
        const customer = await repo.findOne({ where: { id: customerId } });
        if (!customer) {
            throw new core_1.UserInputError('顾客不存在');
        }
        const value = String(openId !== null && openId !== void 0 ? openId : '').trim();
        const app = String(appId !== null && appId !== void 0 ? appId : '').trim() || String((_b = (_a = this.feishuConfig) === null || _a === void 0 ? void 0 : _a.settings.riderAppId) !== null && _b !== void 0 ? _b : '').trim();
        if (value && !app) {
            throw new core_1.UserInputError('骑手飞书应用未配置（FEISHU_RIDER_APP_ID），无法绑定 open_id');
        }
        if (value) {
            const occupied = await repo.createQueryBuilder('customer')
                .where('customer.customFields.riderFeishuOpenId = :openId', { openId: value })
                .andWhere('customer.customFields.riderFeishuAppId = :appId', { appId: app })
                .andWhere('customer.id <> :id', { id: customerId })
                .getCount();
            if (occupied) {
                throw new core_1.UserInputError('该飞书 open_id 已绑定其他顾客，请先解绑原绑定再重绑');
            }
        }
        await repo.update(customerId, {
            customFields: {
                riderFeishuOpenId: value || null,
                riderFeishuAppId: value ? app : null,
                riderFeishuBoundAt: value ? new Date() : null,
            },
        });
        return true;
    }
    async assertApprovedRider(ctx) {
        var _a;
        const customer = await this.requireCustomer(ctx);
        const cf = customer.customFields;
        if (cf.riderStatus !== 'approved') {
            throw new core_1.ForbiddenError();
        }
        if (((_a = cf.riderCredit) !== null && _a !== void 0 ? _a : 100) < CREDIT_LIMIT) {
            throw new core_1.ForbiddenError();
        }
        // P2-5 合规阻断：健康证/保险过期或背调未通过时不得接单
        const compliance = (0, rider_compliance_1.evaluateRiderCompliance)(cf);
        if (compliance.blocked) {
            throw new core_1.UserInputError('骑手合规资料已失效（健康证/保险过期或背调未通过），请联系管理员');
        }
        return customer;
    }
    async myRiderProfile(ctx) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const customer = await this.requireCustomer(ctx);
        const cf = ((_a = customer.customFields) !== null && _a !== void 0 ? _a : {});
        return {
            customerId: customer.id,
            riderStatus: (_b = cf.riderStatus) !== null && _b !== void 0 ? _b : null,
            riderRealName: (_c = cf.riderRealName) !== null && _c !== void 0 ? _c : null,
            riderStudentNo: (_d = cf.riderStudentNo) !== null && _d !== void 0 ? _d : null,
            riderCampus: (_e = cf.riderCampus) !== null && _e !== void 0 ? _e : null,
            riderCredit: (_f = cf.riderCredit) !== null && _f !== void 0 ? _f : null,
            // P2-5：合规明细（骑手端展示到期提醒；不暴露任何其他骑手数据）
            compliance: (0, rider_compliance_1.evaluateRiderCompliance)(cf),
            riderHealthCertExpiry: (_g = cf.riderHealthCertExpiry) !== null && _g !== void 0 ? _g : null,
            riderInsuranceExpiry: (_h = cf.riderInsuranceExpiry) !== null && _h !== void 0 ? _h : null,
        };
    }
    /** P2-5 平台审核：登记/更新骑手合规资料（健康证 / 保险 / 背调），返回最新合规判定 */
    async updateCompliance(ctx, customerId, input) {
        var _a, _b;
        await this.assertCustomerInChannel(ctx, customerId);
        let patch;
        try {
            patch = (0, rider_compliance_1.normalizeCompliancePatch)(input !== null && input !== void 0 ? input : {});
        }
        catch (e) {
            throw new core_1.UserInputError((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : '合规资料不合法');
        }
        if (Object.keys(patch).length) {
            await this.connection.getRepository(ctx, core_1.Customer).update(customerId, { customFields: patch });
        }
        const customer = await this.connection.getRepository(ctx, core_1.Customer).findOne({ where: { id: customerId } });
        const compliance = (0, rider_compliance_1.evaluateRiderCompliance)(((_b = customer === null || customer === void 0 ? void 0 : customer.customFields) !== null && _b !== void 0 ? _b : {}));
        return Object.assign({ customerId }, compliance);
    }
    /** 骑手上下线开关 + 心跳：大厅轮询页每 15s 调 online=true 即续命 */
    async setOnline(ctx, online) {
        var _a, _b, _c;
        const customer = await this.requireCustomer(ctx);
        const status = String((_b = (_a = customer.customFields) === null || _a === void 0 ? void 0 : _a.riderStatus) !== null && _b !== void 0 ? _b : 'none');
        // 未过审（none/pending/suspended）不得上线：避免待审/停用账号写心跳污染在线运力
        if (online && status !== 'approved')
            throw new core_1.ForbiddenError();
        // P2-5 合规阻断：合规资料失效（过期/背调未通过）不得上线
        if (online) {
            const compliance = (0, rider_compliance_1.evaluateRiderCompliance)(((_c = customer.customFields) !== null && _c !== void 0 ? _c : {}));
            if (compliance.blocked) {
                throw new core_1.UserInputError('骑手合规资料已失效（健康证/保险过期或背调未通过），请联系管理员');
            }
        }
        await this.connection.getRepository(ctx, core_1.Customer).update(customer.id, {
            customFields: { riderOnlineAt: online ? new Date() : null },
        });
        // 在线会话：上线开/续、下线关账，用于统计实际在线时长
        await this.riderOps.touchSession(ctx, Number(customer.id), online).catch(() => undefined);
        return { online };
    }
    /**
     * 按 riderStatus 查询入驻申请列表。
     * customFields 为嵌入式物理列，QueryBuilder 用 embedded 路径
     * customer.customFields.riderStatus（与 delivery-plugin 的 order.customFields.* 写法一致）。
     * F8 分页：skip/take 由前端传参，take 缺省 200 兜底防全量。
     */
    async listApplications(ctx, status, skip, take) {
        // 分页参数钳制：防 GraphQL Int 负数（take<1 生成非法 LIMIT）与超大 take 绕过兜底全量拉取
        const safeSkip = Math.max(0, skip !== null && skip !== void 0 ? skip : 0);
        const safeTake = Math.min(Math.max(take !== null && take !== void 0 ? take : 200, 1), 500);
        const [items, total] = await this.connection
            .getRepository(ctx, core_1.Customer)
            .createQueryBuilder('customer')
            // 渠道隔离：Customer 的渠道为多对多，join 后仅返回本店骑手申请
            .leftJoin('customer.channels', 'channel')
            .where('customer.customFields.riderStatus = :status', { status })
            .andWhere('channel.id = :ch', { ch: ctx.channelId })
            .orderBy('customer.id', 'ASC')
            .skip(safeSkip)
            .take(safeTake)
            .getManyAndCount();
        return { items, total };
    }
};
exports.RiderService = RiderService;
exports.RiderService = RiderService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.CustomerService,
        rider_ops_service_1.RiderOpsService,
        feishu_config_1.FeishuConfigService])
], RiderService);
//# sourceMappingURL=rider.service.js.map