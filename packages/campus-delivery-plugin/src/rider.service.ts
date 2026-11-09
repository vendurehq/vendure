import { Injectable } from '@nestjs/common';
import {
    Customer,
    CustomerService,
    ForbiddenError,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { RiderOpsService } from './rider-ops.service';
import { FeishuConfigService } from './feishu/feishu.config';
import {
    evaluateRiderCompliance,
    normalizeCompliancePatch,
    type RiderCompliancePatch,
    type RiderComplianceResult,
} from './rider-compliance';

const CREDIT_LIMIT = 60;

/** 飞书 open_id 反查骑手的五态结果：
 * - unbound：没有任何 Customer 绑定该 open_id
 * - legacyBinding：同 open_id 有绑定，但缺少 appId 或来自其他飞书应用（open_id 应用维度不同，视为失效）
 * - conflict：同应用下多条绑定（历史脏数据），不猜身份
 * - notApproved：已绑定但未过审/已停用
 * - ok：可执行抢单
 */
export type FeishuRiderResolution =
    | { kind: 'unbound' }
    | { kind: 'legacyBinding' }
    | { kind: 'conflict' }
    | { kind: 'notApproved'; customer: Customer }
    | { kind: 'ok'; customer: Customer };

@Injectable()
export class RiderService {
    constructor(
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private riderOps: RiderOpsService,
        /** 骑手飞书应用凭证：绑定未显式传 appId 时取环境变量里的骑手应用 appId */
        private feishuConfig?: FeishuConfigService,
    ) {}

    /** 当前登录顾客；未登录或无对应顾客一律 ForbiddenError。 */
    private async requireCustomer(ctx: RequestContext): Promise<Customer> {
        if (!ctx.activeUserId) {
            throw new ForbiddenError();
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            throw new ForbiddenError();
        }
        return customer;
    }

    async applyRider(
        ctx: RequestContext,
        input: { realName: string; studentNo: string; campus: string; idImg?: string; healthCertImg?: string },
    ) {
        const customer = await this.requireCustomer(ctx);
        const realName = String(input.realName ?? '').trim();
        const studentNo = String(input.studentNo ?? '').trim();
        const campus = String(input.campus ?? '').trim();
        const idImg = input.idImg == null ? null : String(input.idImg).trim();
        const healthCertImg = input.healthCertImg == null ? null : String(input.healthCertImg).trim();
        if (!realName || !studentNo || !campus) {
            throw new UserInputError('请填写姓名、学号和校区');
        }
        // 入参上限：防超长文本写库（字段无长度约束，前端也校验）
        if ([realName, studentNo, campus].some(v => v.length > 30)) {
            throw new UserInputError('姓名、学号、校区均不能超过 30 个字符');
        }
        if (idImg && idImg.length > 500) {
            throw new UserInputError('证件图片地址不合法');
        }
        if (healthCertImg && healthCertImg.length > 500) {
            throw new UserInputError('健康证图片地址不合法');
        }
        const current = String((customer.customFields as any)?.riderStatus ?? 'none');
        // 已停用账号不得自助复申请（否则改回 pending 可绕过停用）；
        // 已通过审核者仅更新资料，保留 approved（重新提交不能把在职骑手打回待审）
        if (current === 'suspended') throw new UserInputError('骑手账号已停用，请联系管理员');
        const status = current === 'approved' ? 'approved' : 'pending';
        await this.connection.getRepository(ctx, Customer).update(customer.id, {
            customFields: {
                riderStatus: status,
                riderRealName: realName,
                riderStudentNo: studentNo,
                riderCampus: campus,
                riderIdImg: idImg,
                // 健康证照片由骑手自助上传（P2-5）；到期日与保险/背调由平台审核登记
                ...(healthCertImg ? { riderHealthCertImg: healthCertImg } : {}),
            },
        } as any);
        return { status };
    }

    /** 骑手归属渠守卫：Customer 的渠道是多对多，必须 join customer.channels。
     * 否则 A 店审核员可按 customerId 查看/停用 B 店骑手（含学号、证件照）。 */
    private async assertCustomerInChannel(ctx: RequestContext, customerId: number): Promise<void> {
        const inChannel = await this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            .leftJoin('customer.channels', 'channel')
            .where('customer.id = :id', { id: customerId })
            .andWhere('channel.id = :ch', { ch: ctx.channelId as any })
            .getOne();
        if (!inChannel) throw new UserInputError('骑手不存在或不属于当前店铺');
    }

    async setRiderStatus(ctx: RequestContext, customerId: number, status: 'approved' | 'suspended' | 'none') {
        if (!['none', 'approved', 'suspended'].includes(String(status ?? ''))) {
            throw new UserInputError('骑手状态不合法');
        }
        await this.assertCustomerInChannel(ctx, customerId);
        const customFields: Record<string, unknown> = { riderStatus: status };
        // 停用/重置即强制下线：否则残留的心跳时间仍让对方出现在在线运力池里被派单
        if (status !== 'approved') customFields.riderOnlineAt = null;
        await this.connection.getRepository(ctx, Customer).update(customerId, {
            customFields,
        } as any);
        // 停用/重置必须回收在途任务：否则已停用骑手名下的 assigned/in_progress 单会卡死，
        // 只能靠运营手工回厅。复用回厅语义（活跃态→open、清骑手指派字段、不复活已取消/终态单）。
        if (status !== 'approved') await this.reclaimActiveTasks(customerId);
        return { status };
    }

    /** 回收某骑手名下在途任务回大厅（单条条件写，避免逐单先读后写）。
     *  仅活跃流转态 + 仍指派本人 + 未取消的单被重置；已送达/异常终态不受影响。 */
    private async reclaimActiveTasks(customerId: number): Promise<number> {
        const ACTIVE_HALL_STATUSES = [
            'open', 'pending_merchant', 'accepted', 'scheduled', 'grabbed', 'third_party',
            'merchant_delivering', 'owned_pool', 'owned_dispatched', 'pending_dispatch',
        ];
        const out: any = await this.connection.rawConnection.query(
            'UPDATE "order" SET "customFieldsHallstatus" = $1, "customFieldsDeliverystaffid" = NULL, '
            + '"customFieldsDeliverystatus" = NULL, "customFieldsAssignedat" = NULL '
            + 'WHERE "customFieldsDeliverystaffid" = $2 AND "customFieldsDeliverystatus" = ANY($3::text[]) '
            + 'AND COALESCE("customFieldsHallstatus", \'\') = ANY($4::text[]) AND "state" <> \'Cancelled\' '
            + 'RETURNING id',
            ['open', String(customerId), ['assigned', 'in_progress'], ACTIVE_HALL_STATUSES],
        );
        const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
        return Array.isArray(rows) ? rows.length : 0;
    }

    /** 飞书 open_id → 骑手 Customer。open_id 是应用维度的，必须与骑手应用的 appId 一起匹配：
     * 缺 appId（历史 A 方案绑定）或来自其他应用的一律视为失效，提示运营重绑，绝不静默当成有效。 */
    async resolveFeishuRider(openId: string, appId?: string): Promise<FeishuRiderResolution> {
        const id = String(openId ?? '').trim();
        if (!id) return { kind: 'unbound' };
        const app = String(appId ?? '').trim();
        const rows = await this.connection.rawConnection.getRepository(Customer)
            .createQueryBuilder('customer')
            .leftJoinAndSelect('customer.user', 'user')
            .where('customer.customFields.riderFeishuOpenId = :openId', { openId: id })
            .getMany();
        if (!rows.length) return { kind: 'unbound' };
        const matched = rows.filter(
            r => String((r.customFields as any)?.riderFeishuAppId ?? '').trim() === app,
        );
        // 有 open_id 绑定但没有一条带当前骑手应用标识：旧绑定已失效，必须重绑
        if (!app || !matched.length) return { kind: 'legacyBinding' };
        // 唯一性在绑定时已校验；历史脏数据/并发写入导致的重复绑定按冲突处理，不猜其中一人
        if (matched.length > 1) return { kind: 'conflict' };
        const customer = matched[0];
        const cf = customer.customFields as any;
        if (cf.riderStatus !== 'approved') return { kind: 'notApproved', customer };
        return { kind: 'ok', customer };
    }

    /** 运营绑定/解绑骑手飞书身份：openId 为空即解绑（可反复重绑，不是一次性绑定）。
     * appId 缺省取环境变量 FEISHU_RIDER_APP_ID，确保「应用 + open_id」成对落库。 */
    async setFeishuBinding(
        ctx: RequestContext,
        customerId: number,
        openId?: string | null,
        appId?: string | null,
    ): Promise<boolean> {
        await this.assertCustomerInChannel(ctx, customerId);
        const repo = this.connection.getRepository(ctx, Customer);
        const customer = await repo.findOne({ where: { id: customerId as any } });
        if (!customer) {
            throw new UserInputError('顾客不存在');
        }
        const value = String(openId ?? '').trim();
        const app = String(appId ?? '').trim() || String(this.feishuConfig?.settings.riderAppId ?? '').trim();
        if (value && !app) {
            throw new UserInputError('骑手飞书应用未配置（FEISHU_RIDER_APP_ID），无法绑定 open_id');
        }
        if (value) {
            const occupied = await repo.createQueryBuilder('customer')
                .where('customer.customFields.riderFeishuOpenId = :openId', { openId: value })
                .andWhere('customer.customFields.riderFeishuAppId = :appId', { appId: app })
                .andWhere('customer.id <> :id', { id: customerId })
                .getCount();
            if (occupied) {
                throw new UserInputError('该飞书 open_id 已绑定其他顾客，请先解绑原绑定再重绑');
            }
        }
        await repo.update(customerId, {
            customFields: {
                riderFeishuOpenId: value || null,
                riderFeishuAppId: value ? app : null,
                riderFeishuBoundAt: value ? new Date() : null,
            },
        } as any);
        return true;
    }

    async assertApprovedRider(ctx: RequestContext) {
        const customer = await this.requireCustomer(ctx);
        const cf = customer.customFields as any;
        if (cf.riderStatus !== 'approved') {
            throw new ForbiddenError();
        }
        if ((cf.riderCredit ?? 100) < CREDIT_LIMIT) {
            throw new ForbiddenError();
        }
        // P2-5 合规阻断：健康证/保险过期或背调未通过时不得接单
        const compliance = evaluateRiderCompliance(cf);
        if (compliance.blocked) {
            throw new UserInputError('骑手合规资料已失效（健康证/保险过期或背调未通过），请联系管理员');
        }
        return customer;
    }

    async myRiderProfile(ctx: RequestContext) {
        const customer = await this.requireCustomer(ctx);
        const cf = (customer.customFields ?? {}) as any;
        return {
            customerId: customer.id,
            riderStatus: cf.riderStatus ?? null,
            riderRealName: cf.riderRealName ?? null,
            riderStudentNo: cf.riderStudentNo ?? null,
            riderCampus: cf.riderCampus ?? null,
            riderCredit: cf.riderCredit ?? null,
            // P2-5：合规明细（骑手端展示到期提醒；不暴露任何其他骑手数据）
            compliance: evaluateRiderCompliance(cf),
            riderHealthCertExpiry: cf.riderHealthCertExpiry ?? null,
            riderInsuranceExpiry: cf.riderInsuranceExpiry ?? null,
        };
    }

    /** P2-5 平台审核：登记/更新骑手合规资料（健康证 / 保险 / 背调），返回最新合规判定 */
    async updateCompliance(
        ctx: RequestContext,
        customerId: number,
        input: RiderCompliancePatch,
    ): Promise<RiderComplianceResult & { customerId: number }> {
        await this.assertCustomerInChannel(ctx, customerId);
        let patch: Record<string, unknown>;
        try {
            patch = normalizeCompliancePatch(input ?? {});
        } catch (e: any) {
            throw new UserInputError(e?.message ?? '合规资料不合法');
        }
        if (Object.keys(patch).length) {
            await this.connection.getRepository(ctx, Customer).update(customerId, { customFields: patch } as any);
        }
        const customer = await this.connection.getRepository(ctx, Customer).findOne({ where: { id: customerId } });
        const compliance = evaluateRiderCompliance((customer?.customFields ?? {}) as any);
        return { customerId, ...compliance };
    }

    /** 骑手上下线开关 + 心跳：大厅轮询页每 15s 调 online=true 即续命 */
    async setOnline(ctx: RequestContext, online: boolean) {
        const customer = await this.requireCustomer(ctx);
        const status = String((customer.customFields as any)?.riderStatus ?? 'none');
        // 未过审（none/pending/suspended）不得上线：避免待审/停用账号写心跳污染在线运力
        if (online && status !== 'approved') throw new ForbiddenError();
        // P2-5 合规阻断：合规资料失效（过期/背调未通过）不得上线
        if (online) {
            const compliance = evaluateRiderCompliance((customer.customFields ?? {}) as any);
            if (compliance.blocked) {
                throw new UserInputError('骑手合规资料已失效（健康证/保险过期或背调未通过），请联系管理员');
            }
        }
        await this.connection.getRepository(ctx, Customer).update(customer.id, {
            customFields: { riderOnlineAt: online ? new Date() : null },
        } as any);
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
    async listApplications(ctx: RequestContext, status: string, skip?: number, take?: number) {
        // 分页参数钳制：防 GraphQL Int 负数（take<1 生成非法 LIMIT）与超大 take 绕过兜底全量拉取
        const safeSkip = Math.max(0, skip ?? 0);
        const safeTake = Math.min(Math.max(take ?? 200, 1), 500);
        const [items, total] = await this.connection
            .getRepository(ctx, Customer)
            .createQueryBuilder('customer')
            // 渠道隔离：Customer 的渠道为多对多，join 后仅返回本店骑手申请
            .leftJoin('customer.channels', 'channel')
            .where('customer.customFields.riderStatus = :status', { status })
            .andWhere('channel.id = :ch', { ch: ctx.channelId as any })
            .orderBy('customer.id', 'ASC')
            .skip(safeSkip)
            .take(safeTake)
            .getManyAndCount();
        return { items, total };
    }
}
