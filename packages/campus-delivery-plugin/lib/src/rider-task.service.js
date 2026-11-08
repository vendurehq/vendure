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
exports.RiderTaskService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const coupon_plugin_1 = require("@vendure/coupon-plugin");
const campus_building_entity_1 = require("./campus-building.entity");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const campus_dedupe_service_1 = require("./campus-dedupe.service");
const campus_notify_service_1 = require("./campus-notify.service");
const errand_service_1 = require("./errand.service");
const feishu_notify_service_1 = require("./feishu/feishu-notify.service");
const handover_code_1 = require("./handover-code");
const hall_service_1 = require("./hall.service");
const privacy_number_service_1 = require("./privacy-number.service");
const rider_credit_service_1 = require("./rider-credit.service");
const rider_earning_entity_1 = require("./rider-earning.entity");
const rider_service_1 = require("./rider.service");
/** 校园骑手平均速度（m/s）：约 15km/h，用于 ETA 粗估 */
const RIDER_SPEED_MPS = 4.2;
/** 交接码连续错误上限 / 锁定时长（进程内计数，pm2 单实例足够）；有效期见 handover-code.ts */
const HANDOVER_MAX_FAILS = 5;
const HANDOVER_LOCK_MS = 10 * 60000;
/** 骑手异常上报类型白名单（与 H5 上报面板四类一致）：防任意字符串污染调度墙与追责记录 */
const EXCEPTION_TYPES = ['merchant_issue', 'no_recipient', 'food_spilled', 'other'];
/** 球面直线距离（米），gcj02 下作为短距离估算足够 */
function haversineMeters(a, b) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}
let RiderTaskService = class RiderTaskService {
    constructor(connection, riderService, credit, hall, notify, privacy, feishu, 
    /** M5 跨实例交接码防爆破（多实例下失败计数与锁止共享）；未注入退回进程内 Map */
    dedupe) {
        this.connection = connection;
        this.riderService = riderService;
        this.credit = credit;
        this.hall = hall;
        this.notify = notify;
        this.privacy = privacy;
        this.feishu = feishu;
        this.dedupe = dedupe;
        /** 交接码连续错误计数 / 锁止截止时间（orderId 维度；M5 经 dedupe 跨实例，未注入时退回进程内 Map） */
        this.handoverFails = new Map();
        this.handoverLockUntil = new Map();
    }
    /** 骑手侧顾客联系方式（号码保护）：仅本单骑手可查，真实号不出服务端。
     * 未开启号码保护时返回真实号（行为与旧版一致），前端统一用 display/callable 展示与拨号。 */
    async customerContact(ctx, orderId) {
        var _a, _b, _c;
        const order = await this.assertOwner(ctx, orderId);
        const withCustomer = await this.connection.getRepository(ctx, core_1.Order).findOne({
            where: { id: order.id },
            relations: ['customer'],
        });
        const phone = (_b = (_a = withCustomer === null || withCustomer === void 0 ? void 0 : withCustomer.customer) === null || _a === void 0 ? void 0 : _a.phoneNumber) !== null && _b !== void 0 ? _b : null;
        return this.privacy.resolve(ctx, {
            channelId: ctx.channelId,
            orderCode: (_c = withCustomer === null || withCustomer === void 0 ? void 0 : withCustomer.code) !== null && _c !== void 0 ? _c : order.code,
            phone,
        });
    }
    /** 订单骑手卡信息：C 端订单跟踪轮询用。未指派返回 null。
     * 位置（plan 2.2）：仅配送中（assigned/in_progress）返回，送达/异常/转单不暴露（隐私）。
     * 跟踪页：附带目标楼栋坐标与直线距离/ETA（楼栋无坐标时均为 null，前端降级）。
     * 归属校验：仅下单人本人可查（原实现可越权读任意订单骑手位置）。 */
    async orderRider(ctx, orderId) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        if (!ctx.activeUserId)
            throw new core_1.ForbiddenError();
        const order = await this.connection
            .getRepository(ctx, core_1.Order)
            .findOne({ where: { id: orderId }, relations: ['customer'] });
        if (!order)
            return null;
        // Customer 实体无 userId 标量属性（user 关系 eager），归属比对取 user.id
        if (((_b = (_a = order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id) !== ctx.activeUserId)
            throw new core_1.ForbiddenError();
        const cf = ((_c = order.customFields) !== null && _c !== void 0 ? _c : {});
        const riderId = Number((_d = cf.deliveryStaffId) !== null && _d !== void 0 ? _d : NaN);
        if (!riderId)
            return null;
        const rider = await this.connection.getRepository(ctx, core_1.Customer).findOne({ where: { id: riderId } });
        if (!rider)
            return null;
        const rcf = ((_e = rider.customFields) !== null && _e !== void 0 ? _e : {});
        const locating = cf.deliveryStatus === 'assigned' || cf.deliveryStatus === 'in_progress';
        // 显式判空：Number(null) === 0 会把「从未上报」误判为 (0,0)
        const hasReport = cf.riderLat != null && cf.riderLng != null;
        const lat = hasReport ? Number(cf.riderLat) : NaN;
        const lng = hasReport ? Number(cf.riderLng) : NaN;
        const location = locating && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
        const buildingId = Number((_f = cf.buildingId) !== null && _f !== void 0 ? _f : NaN);
        let destination = null;
        if (buildingId) {
            const building = await this.connection
                .getRepository(ctx, campus_building_entity_1.CampusBuilding)
                .findOne({ where: { id: buildingId } });
            if (building && building.lat != null && building.lng != null) {
                destination = {
                    name: building.name,
                    detail: (_g = building.detail) !== null && _g !== void 0 ? _g : null,
                    lat: Number(building.lat),
                    lng: Number(building.lng),
                };
            }
        }
        const distanceMeters = location && destination ? Math.round(haversineMeters(location, destination)) : null;
        // 快速估算：校园电瓶车约 15km/h（4.2m/s）；<30m 视为即将送达
        const etaMinutes = distanceMeters == null ? null : distanceMeters < 30 ? 0 : Math.max(1, Math.ceil(distanceMeters / RIDER_SPEED_MPS / 60));
        return {
            realName: (_h = rcf.riderRealName) !== null && _h !== void 0 ? _h : '骑手',
            credit: (_j = rcf.riderCredit) !== null && _j !== void 0 ? _j : 100,
            // 隐私：骑手手机号不向顾客侧透出，与 resolver 契约「姓名+信用分，不含联系方式」保持一致
            phone: null,
            location,
            destination,
            distanceMeters,
            etaMinutes,
            deliveryStatus: (_k = cf.deliveryStatus) !== null && _k !== void 0 ? _k : null,
        };
    }
    /** 骑手位置上报：本人订单 + 仅 assigned/in_progress 可写（plan 2.2，10s/次）。 */
    async reportLocation(ctx, orderId, lat, lng) {
        var _a, _b, _c;
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            throw new core_1.UserInputError('位置坐标不合法');
        }
        const order = await this.assertOwner(ctx, orderId);
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        // 条件写（P3）：与改派/取消并发时，旧骑手不得覆盖新骑手位置，也不得写已终态单
        const res = await this.connection.rawConnection.query('UPDATE "order" SET "customFieldsRiderlat" = $1, "customFieldsRiderlng" = $2 '
            + 'WHERE id = $3 AND "customFieldsDeliverystaffid" = $4 '
            + 'AND "customFieldsDeliverystatus" = ANY($5::text[]) AND "state" <> \'Cancelled\' RETURNING id', [lat, lng, order.id, String((_b = cf.deliveryStaffId) !== null && _b !== void 0 ? _b : ''), ['assigned', 'in_progress']]);
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            throw new core_1.UserInputError('订单已被取消或改派，无法上报位置');
        }
        // P8-4 轨迹留痕：实时位置（Order.customFields）送达即清空，历史点位落 campus_rider_location。
        // 同单 5s 内重复上报不落库（骑手端 10s/次，防重试/多端并发撑大表）；
        // 留痕失败绝不影响实时上报（C 端跟踪优先），仅告警供排查。
        try {
            await this.connection.rawConnection.query('INSERT INTO campus_rider_location '
                + '("createdAt", "updatedAt", "channelId", "orderId", "riderCustomerId", lat, lng, "reportedAt") '
                + 'SELECT now(), now(), $1, $2, $3, $4, $5, now() '
                + 'WHERE NOT EXISTS (SELECT 1 FROM campus_rider_location '
                + `WHERE "orderId" = $2 AND "reportedAt" > now() - interval '5 seconds')`, [ctx.channelId, order.id, Number(cf.deliveryStaffId), lat, lng]);
        }
        catch (e) {
            common_1.Logger.warn(`骑手轨迹留痕失败 order=${order.id}: ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, 'RiderTask');
        }
        return order;
    }
    /** 用户催单（plan 2.4）：仅下单人本人；校园履约单未终态可催（含待接单/大厅阶段）；10min 内重复催单拒绝。
     * 一期催单不推送骑手（骑手端任务卡轮询读 customFields.urged 显示提醒），大厅阶段由调度墙「顾客催单」告警提示运营。 */
    async urgeOrder(ctx, orderId) {
        var _a, _b, _c, _d;
        if (!ctx.activeUserId)
            throw new core_1.ForbiddenError();
        const order = await this.connection
            .getRepository(ctx, core_1.Order)
            .findOne({ where: { id: orderId }, relations: ['customer'] });
        const cf = ((_a = order === null || order === void 0 ? void 0 : order.customFields) !== null && _a !== void 0 ? _a : {});
        const hallStatus = String((_b = cf.hallStatus) !== null && _b !== void 0 ? _b : '');
        const activeHall = [
            'scheduled', 'pending_merchant', 'accepted', 'open', 'grabbed',
            'pending_dispatch', 'third_party', 'owned_pool', 'owned_dispatched', 'merchant_delivering',
        ].includes(hallStatus);
        if (!order || (!cf.deliveryStatus && !activeHall)) {
            throw new core_1.UserInputError('订单不存在或不在配送流程中');
        }
        // Customer 实体无 userId 标量属性（user 关系 eager），归属比对取 user.id
        if (((_d = (_c = order.customer) === null || _c === void 0 ? void 0 : _c.user) === null || _d === void 0 ? void 0 : _d.id) !== ctx.activeUserId) {
            throw new core_1.ForbiddenError();
        }
        const status = cf.deliveryStatus;
        if (status === 'delivered' || status === 'exception' || hallStatus === 'delivered'
            || hallStatus === 'cancelled' || hallStatus === 'no_rider_final' || hallStatus === 'exception_final') {
            throw new core_1.UserInputError('当前状态无需催单');
        }
        const last = cf.urgedAt ? new Date(cf.urgedAt).getTime() : 0;
        if (Date.now() - last < 10 * 60 * 1000) {
            throw new core_1.UserInputError('已收到催单，请耐心等待');
        }
        await this.connection.getRepository(ctx, core_1.Order).update(order.id, {
            customFields: { urged: true, urgedAt: new Date() },
        });
        return order;
    }
    /** 我的任务：本骑手名下已进入配送流程的订单，按下单时间倒序。
     * customFields 为嵌入式物理列，QueryBuilder 用 embedded 路径 order.customFields.deliveryStaffId
     * （与 delivery-plugin 写法一致），裸列 order.deliveryStaffId 在 PG 不存在。
     * 渠道过滤：Order 无标量 channelId，join order.channels 过滤 channel.id（同 hall()）。 */
    async myTasks(ctx, status) {
        const rider = await this.riderService.assertApprovedRider(ctx);
        const qb = this.connection
            .getRepository(ctx, core_1.Order)
            .createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('channel.id = :ch', { ch: ctx.channelId })
            .andWhere('order.customFields.deliveryStaffId = :id', { id: String(rider.id) })
            .andWhere('order.customFields.deliveryStatus IS NOT NULL');
        if (status) {
            qb.andWhere('order.customFields.deliveryStatus = :s', { s: status });
        }
        return qb.orderBy('order.createdAt', 'DESC').getMany();
    }
    /** 转单回大厅：assigned 未取货直接回；in_progress 已取货必须拍照交接存证。
     * 回大厅复用 backToHall（清骑手指派、hallStatus 复位 open），存证写 transferPhotos。
     * 一期转单不扣信用分（规则后续租户可配）。 */
    async transfer(ctx, orderId, photos, note) {
        const order = await this.assertOwner(ctx, orderId);
        const status = order.customFields.deliveryStatus;
        if (status === 'in_progress' && !(photos === null || photos === void 0 ? void 0 : photos.length)) {
            throw new core_1.UserInputError('已取货转单需拍照交接');
        }
        if (status !== 'assigned' && status !== 'in_progress') {
            throw new core_1.UserInputError('当前状态不允许转单');
        }
        // 条件回厅：订单若已被取消/退款脱厅（hallStatus 已终态），不得再改回 open 复活。
        // 位置残留/交接存证与回厅字段同语句写入（CAS 单次 UPDATE），避免两次写之间被取消/改派插入造成半更新。
        const back = await this.hall.backToHall(ctx, order.id, Object.assign({ 
            // 转单即清除位置残留（plan 2.2 隐私：位置只跟随当前配送骑手）
            riderLat: null, riderLng: null }, ((photos === null || photos === void 0 ? void 0 : photos.length)
            ? {
                // transferPhotos 是 string[] 自定义字段（物理列为 simple-array，逗号分隔）：
                // 走原生 SQL 必须自己按该格式序列化，不能传数组（transitionFrom 会 JSON 序列化导致回读异常）
                transferPhotos: photos.join(','),
                transferNote: note !== null && note !== void 0 ? note : null,
                transferAt: new Date(),
            }
            : {})));
        if (!back)
            throw new core_1.UserInputError('订单已被取消或改派，无法转单');
        return order;
    }
    /** 开始配送：assigned → in_progress。
     * 两段接力单（R1/R2 第一段已送达交接点并生成了 handoverCode）必须校验交接码，防丢餐扯皮。 */
    async start(ctx, orderId, code) {
        var _a, _b, _c;
        const order = await this.assertOwner(ctx, orderId, 'assigned');
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        const expected = String((_b = cf.handoverCode) !== null && _b !== void 0 ? _b : '');
        if (expected) {
            const orderKey = Number(order.id);
            if ((0, handover_code_1.isHandoverCodeExpired)(cf.handoverCodeAt)) {
                throw new core_1.UserInputError('交接码已过期，请联系交接点重新核对');
            }
            if (await this.handoverLocked(orderKey)) {
                throw new core_1.UserInputError('交接码错误次数过多，请 10 分钟后再试');
            }
            if (String(code !== null && code !== void 0 ? code : '').trim() !== expected) {
                await this.recordHandoverFail(orderKey);
                throw new core_1.UserInputError('交接码不正确，请与交接点核对后重试');
            }
            await this.clearHandoverGuard(orderKey);
        }
        // 条件写（P2-3）：与用户取消/运营改派并发时，不得把已脱厅/已取消单改成 in_progress
        const res = await this.connection.rawConnection.query('UPDATE "order" SET "customFieldsDeliverystatus" = $1 '
            + 'WHERE id = $2 AND "customFieldsDeliverystatus" = $3 '
            + 'AND "customFieldsDeliverystaffid" = $4 AND "customFieldsHallstatus" = $5 '
            + `AND "state" <> 'Cancelled' RETURNING id`, ['in_progress', order.id, 'assigned', String((_c = cf.deliveryStaffId) !== null && _c !== void 0 ? _c : ''), 'grabbed']);
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            throw new core_1.UserInputError('订单已被取消或改派，无法开始配送');
        }
        return order;
    }
    /** R5 交接码重发后清空该单错误计数与锁定（新码生效，旧失败次数不应继续累计） */
    async resetHandoverGuard(orderId) {
        await this.clearHandoverGuard(Number(orderId));
    }
    /** 是否处于交接码锁止期（跨实例：dedupe 优先，未注入退回进程内 Map） */
    async handoverLocked(orderKey) {
        if (this.dedupe)
            return this.dedupe.seen(`handover_lock:${orderKey}`, HANDOVER_LOCK_MS);
        const until = this.handoverLockUntil.get(orderKey);
        return until != null && until > Date.now();
    }
    /** 记一次交接码错误；达到阈值转为 10 分钟锁止 */
    async recordHandoverFail(orderKey) {
        var _a;
        if (this.dedupe) {
            const fails = await this.dedupe.incr(`handover_fail:${orderKey}`, HANDOVER_LOCK_MS);
            if (fails >= HANDOVER_MAX_FAILS) {
                await this.dedupe.mark(`handover_lock:${orderKey}`, HANDOVER_LOCK_MS);
                await this.dedupe.del(`handover_fail:${orderKey}`);
            }
            return;
        }
        const fails = ((_a = this.handoverFails.get(orderKey)) !== null && _a !== void 0 ? _a : 0) + 1;
        if (fails >= HANDOVER_MAX_FAILS) {
            this.handoverFails.delete(orderKey);
            this.handoverLockUntil.set(orderKey, Date.now() + HANDOVER_LOCK_MS);
        }
        else {
            this.handoverFails.set(orderKey, fails);
        }
    }
    async clearHandoverGuard(orderKey) {
        this.handoverFails.delete(orderKey);
        this.handoverLockUntil.delete(orderKey);
        if (this.dedupe) {
            await this.dedupe.del(`handover_fail:${orderKey}`);
            await this.dedupe.del(`handover_lock:${orderKey}`);
        }
    }
    /** 交接码读取（R1/R2 第二段起送必填）：仅本单骑手、assigned/in_progress 可读。
     *  原实现交接码只写入不暴露，骑手只能线下向交接点口头索取，取不到就卡在 grabbed 直到超时回厅。 */
    async handoverCode(ctx, orderId) {
        var _a;
        const order = await this.assertOwner(ctx, orderId);
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        if (cf.deliveryStatus !== 'assigned' && cf.deliveryStatus !== 'in_progress')
            return null;
        return cf.handoverCode ? String(cf.handoverCode) : null;
    }
    /** 送达：拍照必传 → delivered → 分成入余额（0 分成单跳过入账） */
    async deliver(ctx, orderId, photos, note) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
        if (!(photos === null || photos === void 0 ? void 0 : photos.length))
            throw new core_1.UserInputError('送达需至少一张照片');
        const order = await this.assertOwner(ctx, orderId, 'in_progress');
        const rider = await this.riderService.assertApprovedRider(ctx);
        // 小费以实际收取的 surcharge 为准：customFields.tip 可能因写入失败未真正计费，
        // 按 cf.tip 计分成会虚高（平台多发钱）。
        const tip = this.actualTip(order);
        const earning = this.calcEarning(order, await this.getConfig(ctx, order), tip);
        const deliveredAt = new Date();
        // 单条原子 UPDATE 完成「认领 + 终态」：deliveryStatus 条件更新与 hallStatus/照片/分成/位置清空
        // 同语句落库（原两步写在两步之间宕机会留下 delivered 但 hallStatus 仍旧态的半完成单）。
        // RETURNING id 取 affected 行数，防并发双送达 → 双分成入账（对齐 grab() 的锁语义）。
        const claimed = await this.connection.rawConnection.query('UPDATE "order" SET "customFieldsDeliverystatus" = $1, "customFieldsDeliveredat" = $2, '
            + '"customFieldsHallstatus" = $3, "customFieldsDeliveryphotos" = $4, "customFieldsDeliverynote" = $5, '
            + '"customFieldsRiderearning" = $6, "customFieldsRiderlat" = NULL, "customFieldsRiderlng" = NULL '
            // 已取消单绝不落 delivered（否则取消退款后仍会算作送达并入账分成）；
            // 同时锚定「当前仍是本人的 grabbed 单」，防改派窗口内旧骑手完成送达并领分成。
            + `WHERE id = $7 AND "customFieldsDeliverystatus" = $8 AND "customFieldsDeliverystaffid" = $9 `
            + `AND "customFieldsHallstatus" = $10 AND "state" <> 'Cancelled' RETURNING id`, ['delivered', deliveredAt, 'delivered', JSON.stringify(photos), note !== null && note !== void 0 ? note : null, earning, order.id, 'in_progress',
            String((_a = order.customFields.deliveryStaffId) !== null && _a !== void 0 ? _a : ''), 'grabbed']);
        const claimedRows = Array.isArray(claimed) ? claimed[0] : claimed;
        if (!(claimedRows === null || claimedRows === void 0 ? void 0 : claimedRows.length))
            throw new core_1.UserInputError('订单已被取消或处理，无法送达');
        if (earning === 0) {
            // 0 分成单：不写 earning 不调 addBalance（余额端口对 0 金额入账会抛错，
            // 且 0 金额 pending 行会在钱包补账时永久重试报错）。
            // 判据只看 earning（小费已计入 calcEarning），避免 earning=0 但 tip>0 时仍落 0 元 pending。
            common_1.Logger.log(`订单 ${(_b = order.code) !== null && _b !== void 0 ? _b : order.id} 0 分成，跳过入账`, 'RiderTask');
        }
        else {
            // 先落 earning（pending），入账成功才置 credited：addBalance 失败时订单已终态、
            // 骑手重试会被状态机挡住，留 pending 供 myRiderWallet 读取时补账（避免「有分成记录但钱未到」）。
            // 外层兜底：earning 行落库失败时订单已送达（客户端重试会被状态机挡住），只记错误日志供人工补账。
            try {
                const earningRow = await this.connection.getRepository(ctx, rider_earning_entity_1.RiderEarning).save({
                    orderId: order.id,
                    riderCustomerId: rider.id,
                    amount: earning,
                    tip,
                    status: 'pending',
                    channelId: ctx.channelId,
                });
                // 行级认领后再入账（P1）：防「入账成功但置 credited 失败 → 钱包补账再次入账」与并发补账双加；
                // 认领失败说明另一路已在处理，直接跳过。
                const claimed = await this.connection.rawConnection.query('UPDATE rider_earning SET status = $1 WHERE id = $2 AND status = $3 RETURNING id', ['crediting', earningRow.id, 'pending']);
                const claimedRows = Array.isArray(claimed) && Array.isArray(claimed[0]) ? claimed[0] : claimed;
                if (!Array.isArray(claimedRows) || !claimedRows.length) {
                    common_1.Logger.warn(`分成 ${earningRow.id} 已被另一路认领，跳过本次入账`, 'RiderTask');
                }
                else {
                    const port = (0, coupon_plugin_1.getCouponBalancePort)();
                    if (port) {
                        try {
                            await port.addBalance(ctx, rider.id, earning);
                            await this.connection.getRepository(ctx, rider_earning_entity_1.RiderEarning).update(earningRow.id, {
                                status: 'credited',
                            });
                        }
                        catch (e) {
                            // 回 pending 供钱包补账重试（crediting 需等待超时才可重试）
                            await this.connection.getRepository(ctx, rider_earning_entity_1.RiderEarning)
                                .update(earningRow.id, { status: 'pending' })
                                .catch(() => undefined);
                            common_1.Logger.error(`分成入账失败（earning ${earningRow.id} 留 pending 待补账）：${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, 'RiderTask');
                        }
                    }
                    else {
                        common_1.Logger.warn('余额端口未注册，分成未入账', 'RiderTask');
                        await this.connection.getRepository(ctx, rider_earning_entity_1.RiderEarning)
                            .update(earningRow.id, { status: 'pending' })
                            .catch(() => undefined);
                    }
                }
            }
            catch (e) {
                common_1.Logger.error(`分成落库失败（订单已送达 ${(_d = order.code) !== null && _d !== void 0 ? _d : order.id}，需人工补账 ${earning} 分）：${(_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e}`, 'RiderTask');
                // 订单已送达不可重试，分成只能人工补：仅日志会静默丢钱，必须推运营群
                void ((_f = this.feishu) === null || _f === void 0 ? void 0 : _f.pushEvent('alert', '骑手分成落库失败', `订单 ${(_g = order.code) !== null && _g !== void 0 ? _g : order.id} 已送达，但分成 ${earning} 分未落库，请人工补账。原因：${(_h = e === null || e === void 0 ? void 0 : e.message) !== null && _h !== void 0 ? _h : e}`, order.code, `earning_persist_failed:${(_j = order.code) !== null && _j !== void 0 ? _j : order.id}`));
            }
        }
        // 完单信用加分（+2）；非资金项，失败不阻断送达
        try {
            await this.credit.adjust(ctx, rider.id, rider_credit_service_1.CREDIT_COMPLETE, 'complete', order.id);
        }
        catch (e) {
            common_1.Logger.warn(`完单信用加分失败：${(_k = e === null || e === void 0 ? void 0 : e.message) !== null && _k !== void 0 ? _k : e}`, 'RiderTask');
        }
        // 通知下单用户已送达（fire-and-forget）
        this.notify.user(ctx, order.id, 'orderDelivered');
        return order;
    }
    /** 异常上报：仅配送中（已接单/配送中）可上报，记录上报时间供调度扫描超时升级 */
    async reportException(ctx, orderId, type, photos, note) {
        var _a, _b, _c;
        if (!EXCEPTION_TYPES.includes(String(type !== null && type !== void 0 ? type : ''))) {
            throw new core_1.UserInputError('异常类型不合法');
        }
        const order = await this.assertOwner(ctx, orderId);
        const status = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.deliveryStatus;
        if (status !== 'assigned' && status !== 'in_progress') {
            throw new core_1.UserInputError('当前状态不允许上报异常');
        }
        // 条件写：并发取消/改派时不得把非本人/已终态单改成 exception（原先读后写存在竞态）
        const res = await this.connection.rawConnection.query('UPDATE "order" SET "customFieldsDeliverystatus" = $1, "customFieldsExceptiontype" = $2, '
            + '"customFieldsExceptionphotos" = $3, "customFieldsExceptionnote" = $4, '
            + '"customFieldsExceptionreportedat" = $5 '
            + 'WHERE id = $6 AND "customFieldsDeliverystatus" = ANY($7::text[]) '
            + 'AND "customFieldsDeliverystaffid" = $8 AND "state" <> \'Cancelled\' RETURNING id', ['exception', type, JSON.stringify(photos !== null && photos !== void 0 ? photos : []), note !== null && note !== void 0 ? note : null, new Date(), order.id,
            ['assigned', 'in_progress'], String((_c = (_b = order.customFields) === null || _b === void 0 ? void 0 : _b.deliveryStaffId) !== null && _c !== void 0 ? _c : '')]);
        const rows = Array.isArray(res) && Array.isArray(res[0]) ? res[0] : res;
        if (!Array.isArray(rows) || !rows.length) {
            throw new core_1.UserInputError('订单已被取消或改派，无法上报异常');
        }
        return order;
    }
    /** 实收跑腿小费：以订单小费 surcharge 合计为准（0 元小费在 errand.service 只清不加） */
    actualTip(order) {
        var _a;
        const list = ((_a = order.surcharges) !== null && _a !== void 0 ? _a : []);
        return list
            .filter(s => (s === null || s === void 0 ? void 0 : s.description) === errand_service_1.ERRAND_TIP_SURCHARGE_DESC)
            .reduce((sum, s) => { var _a; return sum + Number((_a = s === null || s === void 0 ? void 0 : s.listPrice) !== null && _a !== void 0 ? _a : 0); }, 0);
    }
    calcEarning(order, cfg, tip) {
        // 跑腿单：跑腿费在 orderLines 单价中（虚拟商品 0 元时全在 shipping）；统一取 shipping + 实收小费
        const shipping = order.shipping || 0;
        return Math.floor(((shipping + tip) * cfg.riderCommissionRate) / 100);
    }
    /** 配送配置按订单所属渠道解析（P2）：跨店骑手请求头渠道与订单渠道不一致时，佣金比例必须锚定订单渠道 */
    async getConfig(ctx, order) {
        var _a, _b, _c;
        const orderChannelId = Number((_c = (_b = ((_a = order === null || order === void 0 ? void 0 : order.channels) !== null && _a !== void 0 ? _a : [])[0]) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : NaN);
        const channelId = Number.isFinite(orderChannelId) && orderChannelId > 0 ? orderChannelId : ctx.channelId;
        const cfg = await this.connection
            .getRepository(ctx, campus_fulfillment_config_entity_1.CampusFulfillmentConfig)
            .findOne({ where: { channelId: channelId } });
        if (!cfg)
            throw new core_1.UserInputError('校园履约未配置');
        return cfg;
    }
    async assertOwner(ctx, orderId, expect) {
        const rider = await this.riderService.assertApprovedRider(ctx);
        const order = await this.connection
            .getRepository(ctx, core_1.Order)
            .findOne({ where: { id: orderId }, relations: ['customer', 'channels', 'surcharges'] });
        const cf = order === null || order === void 0 ? void 0 : order.customFields;
        if (!order || (cf === null || cf === void 0 ? void 0 : cf.deliveryStaffId) !== String(rider.id))
            throw new core_1.ForbiddenError();
        if (expect && (cf === null || cf === void 0 ? void 0 : cf.deliveryStatus) !== expect) {
            throw new core_1.UserInputError(`当前状态不允许该操作（期望 ${expect}）`);
        }
        return order;
    }
};
exports.RiderTaskService = RiderTaskService;
exports.RiderTaskService = RiderTaskService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        rider_service_1.RiderService,
        rider_credit_service_1.RiderCreditService,
        hall_service_1.HallService,
        campus_notify_service_1.CampusNotifyService,
        privacy_number_service_1.PrivacyNumberService,
        feishu_notify_service_1.FeishuNotifyService,
        campus_dedupe_service_1.CampusDedupeService])
], RiderTaskService);
//# sourceMappingURL=rider-task.service.js.map