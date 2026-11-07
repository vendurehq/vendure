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
exports.ThirdPartyDeliveryService = void 0;
exports.nextHallStateAfterHandover = nextHallStateAfterHandover;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const core_2 = require("@vendure/core");
const campus_building_entity_1 = require("./campus-building.entity");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const campus_notify_service_1 = require("./campus-notify.service");
const hall_service_1 = require("./hall.service");
const route_matrix_1 = require("./route-matrix");
const loggerCtx = 'ThirdPartyDelivery';
/** customFields 物理列名（thirdPartyState → customFieldsThirdpartystate） */
const cfColumn = (field) => `"customFields${field.charAt(0).toUpperCase()}${field.slice(1).toLowerCase()}"`;
/** 外部运单状态推进序（回调乱序时只接受前进，不接受回退）。
 *  cancelled/exception 与 delivered 同属终态档：终态之后到达的任何回调一律忽略。 */
const TP_STATUS_RANK = {
    pending: 0,
    accepted: 1,
    pickup: 2,
    delivered: 3,
    cancelled: 4,
    exception: 4,
};
/** 第一段完成后的本地状态（纯函数，便于单测）：只有「直送」才算完成，其余都进大厅接力 */
function nextHallStateAfterHandover(handover) {
    if (handover === 'direct_to_user')
        return { hallStatus: 'delivered', deliveryStatus: 'delivered' };
    return { hallStatus: 'open', deliveryStatus: null };
}
let ThirdPartyDeliveryService = class ThirdPartyDeliveryService {
    constructor(connection, hall, notify, moduleRef) {
        this.connection = connection;
        this.hall = hall;
        this.notify = notify;
        this.moduleRef = moduleRef;
    }
    onApplicationBootstrap() {
        var _a;
        try {
            this.gateway.registerStatusSink(this);
            core_2.Logger.info('外部快递状态回调已接入订单履约', loggerCtx);
        }
        catch (e) {
            core_2.Logger.warn(`外部快递状态回调接入失败: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx);
        }
    }
    /** 懒解析网关（字符串 token，避免 campus → gateway 编译依赖） */
    get gateway() {
        return new core_2.Injector(this.moduleRef).get('DeliveryGatewayService');
    }
    get cfgRepo() {
        return this.connection.rawConnection.getRepository(campus_fulfillment_config_entity_1.CampusFulfillmentConfig);
    }
    orderRepo(ctx) {
        return this.connection.getRepository(ctx, core_2.Order);
    }
    async ctxForChannel(channelId) {
        var _a;
        const channel = (_a = (await this.connection.rawConnection.getRepository(core_2.Channel).findOne({
            where: { id: channelId },
            relations: ['defaultTaxZone'],
        }))) !== null && _a !== void 0 ? _a : new core_2.Channel({ id: channelId });
        return new core_2.RequestContext({ apiType: 'admin', channel, isAuthorized: true, authorizedAsOwnerOnly: false });
    }
    /**
     * 推送外部快递（运营中心在派单时选择提供方）。
     * - R2：外部快递从商户取货 → 校园交接点（R2 交接点）
     * - R3：当前策略为 external 时，外部快递整段直送学生
     */
    async dispatchExternal(ctx, orderId, provider) {
        var _a;
        if (provider !== 'dada' && provider !== 'meituan')
            throw new core_2.UserInputError('外部快递仅支持 dada/meituan');
        // 并发/重复推送：订单级咨询锁串行化，防两名运营同时推送产生两张外部运单（孤儿单 + 双倍运费）。
        // 锁内重读订单，「已在途不重推」的前置判断才可靠。
        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:thirdparty:${orderId}`;
        try {
            const got = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
            const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
            if (!((_a = rows === null || rows === void 0 ? void 0 : rows[0]) === null || _a === void 0 ? void 0 : _a.ok))
                throw new core_2.UserInputError('该订单正在推送外部快递，请稍后重试');
            return await this.doDispatchExternal(ctx, orderId, provider);
        }
        finally {
            try {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
            }
            catch (_b) {
                // 释放失败交给连接回收兜底
            }
            await runner.release();
        }
    }
    /** 推送主体（须由 dispatchExternal 持订单级锁调用）：幂等判断与下单在同一锁内 */
    async doDispatchExternal(ctx, orderId, provider) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1;
        const order = await this.orderRepo(ctx).findOne({
            where: { id: orderId },
            // shippingAddress 是 simple-json 列，不可作为 relation 加载；列本身随查询返回
            relations: ['channels', 'lines', 'lines.productVariant', 'customer'],
        });
        if (!order)
            throw new core_2.UserInputError('订单不存在');
        const cf = order.customFields;
        if (cf.hallStatus === 'cancelled')
            throw new core_2.UserInputError('订单已取消');
        // 已成功推送则在途，不重复下单；但平台取消/异常后允许换一家重推
        if (cf.thirdPartyNo && !['cancelled', 'exception'].includes(String((_a = cf.thirdPartyState) !== null && _a !== void 0 ? _a : ''))) {
            return { ok: true, already: true, thirdPartyNo: cf.thirdPartyNo };
        }
        const channelId = (_d = (_c = (_b = order.channels) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : ctx.channelId;
        const cfg = await this.cfgRepo.findOne({ where: { channelId: channelId } });
        if (!cfg)
            throw new core_2.UserInputError('店铺未配置履约信息');
        const route = String((_e = cf.fulfillmentRoute) !== null && _e !== void 0 ? _e : '');
        const plan = (0, route_matrix_1.resolveRoutePlan)(route, cfg, provider);
        if (!plan)
            throw new core_2.UserInputError(`路线 ${route} 不支持外部快递`);
        // 在途单以「下单快照」为准，避免中途改配置换运力
        const leg1 = String(cf.deliveryPlan || plan.leg1);
        if (plan.dispatch !== 'external_push' && leg1 !== 'external_courier') {
            throw new core_2.UserInputError(`路线 ${route} 当前未启用外部快递`);
        }
        const oCtx = await this.ctxForChannel(channelId);
        const pickup = (0, route_matrix_1.resolvePickup)(plan.route, cfg);
        if (!pickup)
            throw new core_2.UserInputError('店铺取货点经纬度缺失，无法推送外部快递');
        const building = cf.buildingId
            ? await this.connection.rawConnection.getRepository(campus_building_entity_1.CampusBuilding).findOne({
                where: { id: Number(cf.buildingId) },
            })
            : null;
        const userPoint = {
            name: (_g = (_f = order.shippingAddress) === null || _f === void 0 ? void 0 : _f.fullName) !== null && _g !== void 0 ? _g : '用户',
            // 改址（P2-4）只写订单 campus 字段（buildingId/campusZone/deliveryDetail），
            // shippingAddress.streetLine1 仍是下单时地址，推送外部运单必须按实时字段拼装。
            address: [building === null || building === void 0 ? void 0 : building.name, cf.deliveryDetail || ((_h = order.shippingAddress) === null || _h === void 0 ? void 0 : _h.streetLine1)]
                .filter(Boolean)
                .join(' ') || undefined,
            lat: Number((_j = building === null || building === void 0 ? void 0 : building.lat) !== null && _j !== void 0 ? _j : 0),
            lng: Number((_k = building === null || building === void 0 ? void 0 : building.lng) !== null && _k !== void 0 ? _k : 0),
            phone: (_m = (_l = order.shippingAddress) === null || _l === void 0 ? void 0 : _l.phoneNumber) !== null && _m !== void 0 ? _m : undefined,
        };
        // 交接点按「本路线」取：下单快照优先，缺失才用店铺当前配置
        const snapPoint = cf.handoverPointLat != null && cf.handoverPointLng != null
            ? {
                name: String((_o = cf.handoverPointName) !== null && _o !== void 0 ? _o : ''),
                address: (_p = cf.handoverPointAddress) !== null && _p !== void 0 ? _p : undefined,
                lat: Number(cf.handoverPointLat),
                lng: Number(cf.handoverPointLng),
            }
            : undefined;
        const effCfg = Object.assign(Object.assign({}, cfg), { handoverPoints: Object.assign(Object.assign({}, ((_q = cfg.handoverPoints) !== null && _q !== void 0 ? _q : {})), (snapPoint ? { [plan.route]: [snapPoint] } : {})) });
        // 无快照时按楼栋坐标挑最近交接点；楼栋缺坐标则由默认点兜底
        const dest = (building === null || building === void 0 ? void 0 : building.lat) != null && (building === null || building === void 0 ? void 0 : building.lng) != null
            ? { lat: Number(building.lat), lng: Number(building.lng) }
            : null;
        const dropoff = (0, route_matrix_1.resolveDropoff)(plan.route, plan, effCfg, userPoint, dest);
        if (!dropoff)
            throw new core_2.UserInputError(`路线 ${plan.route} 未配置校园交接点，无法推送外部快递`);
        if (!dropoff.lat || !dropoff.lng)
            throw new core_2.UserInputError('收货点经纬度缺失，无法推送外部快递');
        const delivery = await this.gateway.createDelivery(oCtx, {
            orderId: order.id,
            packageId: String(order.id),
            providerCode: provider,
            providerShopNo: (_s = (_r = cfg.providerShopNo) === null || _r === void 0 ? void 0 : _r[provider]) !== null && _s !== void 0 ? _s : undefined,
            pickup,
            dropoff,
            items: ((_t = order.lines) !== null && _t !== void 0 ? _t : []).map(l => { var _a, _b; return ({ name: (_b = (_a = l.productVariant) === null || _a === void 0 ? void 0 : _a.name) !== null && _b !== void 0 ? _b : '餐品', quantity: l.quantity }); }),
            remark: (_u = cf.note) !== null && _u !== void 0 ? _u : undefined,
        });
        // 落库改条件写（P1-1）：下单与落库之间用户可能已取消（hallStatus 已脱厅或订单 state=Cancelled），
        // 无条件写会把已退款单改回 third_party 复活，并留下孤儿运单（双份运费）。
        const committed = await this.hall.transitionFrom(oCtx, orderId, ['pending_merchant', 'accepted', 'pending_dispatch', 'third_party'], {
            deliveryPlan: 'external_courier',
            handoverMode: (_v = plan.handover) !== null && _v !== void 0 ? _v : '',
            thirdPartyProvider: provider,
            thirdPartyDeliveryOrderId: String(delivery.id),
            thirdPartyNo: (_w = delivery.thirdPartyNo) !== null && _w !== void 0 ? _w : delivery.code,
            thirdPartyState: delivery.status,
            thirdPartyDispatchAt: new Date(),
            // 重新推单视为新的外部履约周期：清掉工单关闭回写的异常标记，后续异常可再次告警/建单
            exceptionResolvedAt: null,
            handoverPointName: (_x = dropoff.name) !== null && _x !== void 0 ? _x : '',
            handoverPointAddress: (_y = dropoff.address) !== null && _y !== void 0 ? _y : null,
            handoverPointLat: dropoff.lat,
            handoverPointLng: dropoff.lng,
            hallStatus: 'third_party',
            campusCause: 'external_dispatched',
        });
        if (!committed) {
            // 订单已取消/已流转：立刻撤回刚创建的外部运单，避免快递按旧单上门取餐
            let revoked = false;
            try {
                const res = await this.gateway.cancelDelivery(oCtx, delivery.id, 'order state changed before commit');
                revoked = !!(res === null || res === void 0 ? void 0 : res.success);
            }
            catch (e) {
                core_2.Logger.error(`订单 ${order.code} 外部运单 ${delivery.id} 撤销失败，需人工处理：${(_z = e === null || e === void 0 ? void 0 : e.message) !== null && _z !== void 0 ? _z : e}`, loggerCtx);
            }
            if (!revoked) {
                core_2.Logger.error(`订单 ${order.code} 已不处于可推送状态，外部运单 ${delivery.id} 未确认撤销（孤儿单风险）`, loggerCtx);
            }
            throw new core_2.UserInputError('订单状态已变更（可能已取消），外部运单已撤销');
        }
        core_2.Logger.info(`订单 ${order.code} 已推送 ${provider}:${(_0 = delivery.thirdPartyNo) !== null && _0 !== void 0 ? _0 : delivery.code}`, loggerCtx);
        return { ok: true, thirdPartyNo: (_1 = delivery.thirdPartyNo) !== null && _1 !== void 0 ? _1 : delivery.code, provider };
    }
    /** 取消外部快递配送（商家关单 / 推送失败回落前调用），幂等。
     * 与 dispatchExternal 共用订单级咨询锁：否则「推送中」被取消可能产生孤儿运单或取消不存在的单。 */
    async cancel(ctx, orderId, reason) {
        var _a;
        const runner = this.connection.rawConnection.createQueryRunner();
        await runner.connect();
        const lockKey = `campus:thirdparty:${orderId}`;
        try {
            // 推送临界区很短：短暂重试后仍拿不到锁才放弃（取消是订单终态动作，尽量别丢）
            let locked = false;
            for (let attempt = 0; attempt < 3 && !locked; attempt += 1) {
                const got = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
                const rows = Array.isArray(got) && Array.isArray(got[0]) ? got[0] : got;
                locked = !!((_a = rows === null || rows === void 0 ? void 0 : rows[0]) === null || _a === void 0 ? void 0 : _a.ok);
                if (!locked)
                    await new Promise(r => setTimeout(r, 300));
            }
            if (!locked)
                throw new core_2.UserInputError('该订单正在推送/取消外部快递，请稍后重试');
            return await this.doCancel(ctx, orderId, reason);
        }
        finally {
            try {
                await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]);
            }
            catch (_b) {
                // 释放失败交给连接回收兜底
            }
            await runner.release();
        }
    }
    async doCancel(ctx, orderId, reason) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const order = await this.orderRepo(ctx).findOne({ where: { id: orderId }, relations: ['channels'] });
        if (!order)
            throw new core_2.UserInputError('订单不存在');
        const cf = order.customFields;
        if (!cf.thirdPartyDeliveryOrderId)
            return { ok: true, skipped: true };
        const oCtx = await this.ctxForChannel((_c = (_b = (_a = order.channels) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : ctx.channelId);
        const res = await this.gateway.cancelDelivery(oCtx, Number(cf.thirdPartyDeliveryOrderId), reason);
        if (res.success) {
            // 平台取消成功后立刻回退本地状态，不等超时扫描：
            // R2 回待推送（运营换一家），R3 回抢单大厅（传信者兜底）。
            // 条件写（CAS）：并发下订单可能已被取消/已被其它路径回退，读后无条件写会把已退款单复活。
            const fresh = await this.orderRepo(oCtx).findOne({ where: { id: orderId } });
            const hs = String((_e = (_d = fresh === null || fresh === void 0 ? void 0 : fresh.customFields) === null || _d === void 0 ? void 0 : _d.hallStatus) !== null && _e !== void 0 ? _e : '');
            const route = String((_g = (_f = fresh === null || fresh === void 0 ? void 0 : fresh.customFields) === null || _f === void 0 ? void 0 : _f.fulfillmentRoute) !== null && _g !== void 0 ? _g : '');
            if (hs === 'third_party') {
                const patch = {
                    thirdPartyState: 'cancelled',
                    campusCause: 'third_party_cancelled',
                };
                if (route === 'R2') {
                    patch.hallStatus = 'pending_dispatch';
                    patch.thirdPartyDispatchAt = new Date();
                }
                else {
                    patch.hallStatus = 'open';
                    patch.hallEnteredAt = new Date();
                    patch.deliveryPlan = 'campus_rider';
                    patch.handoverMode = '';
                    patch.thirdPartyProvider = '';
                }
                const moved = await this.hall.transitionFrom(oCtx, orderId, ['third_party'], patch);
                if (!moved) {
                    // 读后被取消/回退：只补第三方状态，绝不动 hallStatus
                    await this.writeThirdPartyPatch(orderId, { thirdPartyState: 'cancelled', campusCause: 'third_party_cancelled' }, String((_h = cf.thirdPartyState) !== null && _h !== void 0 ? _h : ''));
                }
            }
            else {
                await this.writeThirdPartyPatch(orderId, { thirdPartyState: 'cancelled', campusCause: 'third_party_cancelled' }, String((_j = cf.thirdPartyState) !== null && _j !== void 0 ? _j : ''));
            }
        }
        return { ok: res.success, reason: res.reason };
    }
    /** 轮询对账：主动向平台查询运单状态（防外部回调丢失），幂等交给网关状态机。
     * 已到终态/未推送的订单直接跳过；Provider 未实现 queryStatus 时网关返回 null（静默）。 */
    async syncStatus(ctx, orderId) {
        var _a, _b, _c, _d, _e;
        const order = await this.orderRepo(ctx).findOne({ where: { id: orderId }, relations: ['channels'] });
        if (!order)
            return { ok: false, skipped: 'missing' };
        const cf = order.customFields;
        if (!cf.thirdPartyDeliveryOrderId)
            return { ok: false, skipped: 'no-delivery' };
        if (['delivered', 'cancelled'].includes(String((_a = cf.thirdPartyState) !== null && _a !== void 0 ? _a : ''))) {
            return { ok: false, skipped: 'final' };
        }
        const oCtx = await this.ctxForChannel((_d = (_c = (_b = order.channels) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.id) !== null && _d !== void 0 ? _d : ctx.channelId);
        const delivery = await this.gateway.syncDeliveryStatus(oCtx, Number(cf.thirdPartyDeliveryOrderId));
        return { ok: !!delivery, state: (_e = delivery === null || delivery === void 0 ? void 0 : delivery.status) !== null && _e !== void 0 ? _e : null };
    }
    /** 第三方字段条件写（P3）：guardState 非空时要求 thirdPartyState 仍为读取时的值（防并发回退），
     * 且始终要求订单未取消——已退款取消单不得被迟到回调写回履约态。 */
    async writeThirdPartyPatch(orderId, patch, guardState) {
        const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
        if (!entries.length)
            return false;
        const sets = entries.map(([k], i) => `${cfColumn(k)} = $${i + 2}`).join(', ');
        const values = entries.map(([, v]) => (Array.isArray(v) ? JSON.stringify(v) : v));
        const guard = guardState !== undefined
            ? `COALESCE("customFieldsThirdpartystate", '') = $${entries.length + 2}`
            : 'TRUE';
        const out = await this.connection.rawConnection.query(`UPDATE "order" SET ${sets} WHERE id = $1 AND ${guard} AND "state" <> 'Cancelled' RETURNING id`, [orderId, ...values, ...(guardState !== undefined ? [guardState] : [])]);
        const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
        return Array.isArray(rows) && rows.length > 0;
    }
    /** 网关回调（由 DeliveryStatusSink 调用） */
    async onDeliveryStatus(ctx, update) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        const order = await this.orderRepo(ctx).findOne({
            where: { id: update.orderId },
            relations: ['channels', 'customer'],
        });
        if (!order) {
            core_2.Logger.warn(`回调订单不存在 #${update.orderId}`, loggerCtx);
            return;
        }
        const channelId = (_c = (_b = (_a = order.channels) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : ctx.channelId;
        const oCtx = await this.ctxForChannel(channelId);
        const cf = order.customFields;
        // 旧运单迟到回调：订单重新推送过外部快递（cancelled/exception 后换运力）时，
        // 旧运单号回调不得覆盖新运单状态。
        if (cf.thirdPartyNo && update.thirdPartyNo && String(cf.thirdPartyNo) !== String(update.thirdPartyNo)) {
            core_2.Logger.warn(`订单 ${order.code} 回调运单号不匹配（当前 ${cf.thirdPartyNo}，回调 ${update.thirdPartyNo}），忽略`, loggerCtx);
            return;
        }
        // 回调幂等/防回退：同状态重复、旧状态乱序、送达后的迟到回调一律忽略。
        // 否则重复 delivered 会把已进大厅/已被抢的单再次 enterHallForHandover
        //（清空骑手、重新生成交接码 → 可二次配送、二次分成）。
        const current = String((_d = cf.thirdPartyState) !== null && _d !== void 0 ? _d : '');
        const incomingRank = TP_STATUS_RANK[update.status];
        if (current === update.status)
            return;
        if (current === 'delivered')
            return;
        if (TP_STATUS_RANK[current] != null && incomingRank != null && incomingRank < TP_STATUS_RANK[current])
            return;
        const patch = {
            thirdPartyState: update.status,
            thirdPartyNo: update.thirdPartyNo || cf.thirdPartyNo,
        };
        if (update.courierName)
            patch.thirdPartyCourierName = update.courierName;
        if (update.courierPhone)
            patch.thirdPartyCourierPhone = update.courierPhone;
        const orderIdNum = Number(order.id);
        const hallStatus = String((_e = cf.hallStatus) !== null && _e !== void 0 ? _e : '');
        if (update.status === 'delivered') {
            // 第一段已结束（已进大厅 / 已被抢 / 已送达）：迟到或重复回调只补终态与快递员信息，不重置履约链路
            if (hallStatus !== 'third_party') {
                // 条件写（取消后不补写）：已退款取消单不应再被标成 delivered 污染报表口径
                const written = await this.writeThirdPartyPatch(orderIdNum, patch);
                if (!written) {
                    core_2.Logger.warn(`订单 ${order.code} 迟到送达回调忽略（订单已取消）`, loggerCtx);
                }
                return;
            }
            const next = nextHallStateAfterHandover(String((_f = cf.handoverMode) !== null && _f !== void 0 ? _f : ''));
            if (next.hallStatus === 'open') {
                // R1/R2：送达交接点 → 进大厅接力。条件写（仅 third_party）：
                // 与用户取消并发时不得把已退款单拉回大厅（否则可被抢、被送达、领分成）。
                const code = await this.hall.enterHallForHandover(oCtx, orderIdNum, 'external_handover', ['third_party'], Object.assign(Object.assign(Object.assign({}, patch), { handoverAt: new Date() }), (String((_g = cf.fulfillmentRoute) !== null && _g !== void 0 ? _g : '') === 'R2' ? { leg1Status: 'arrived_gate' } : {})));
                if (!code) {
                    core_2.Logger.warn(`订单 ${order.code} 外部送达回调未入厅（订单已取消或状态已变更）`, loggerCtx);
                }
                return;
            }
            // R3 外部快递整段直送：直接完成（条件写，取消后不复活）
            const done = await this.hall.transitionFrom(oCtx, orderIdNum, ['third_party'], Object.assign(Object.assign({}, patch), { hallStatus: 'delivered', deliveryStatus: 'delivered', deliveredAt: new Date(), handoverAt: new Date() }));
            if (!done) {
                core_2.Logger.warn(`订单 ${order.code} 外部送达回调未完成（订单已取消或状态已变更）`, loggerCtx);
                return;
            }
            if (cf.handoverMode === 'direct_to_user') {
                this.notify.user(oCtx, order.id, 'orderDelivered');
            }
            return;
        }
        if (update.status === 'cancelled' || update.status === 'exception') {
            const route = String((_h = cf.fulfillmentRoute) !== null && _h !== void 0 ? _h : '');
            if (route === 'R2') {
                // R2 回到待推送，由运营中心换一家外部快递
                patch.hallStatus = 'pending_dispatch';
                patch.campusCause = update.status === 'exception' ? 'external_exception' : 'external_cancelled';
            }
            else {
                // R3 运力失败 → 回抢单大厅，由传信者兜底。
                // 刷新入厅时间：否则 T4 按旧 hallEnteredAt 判定滞留，可能立即自动退款。
                patch.hallStatus = 'open';
                patch.hallEnteredAt = new Date();
                patch.deliveryPlan = 'campus_rider';
                patch.handoverMode = '';
                patch.thirdPartyProvider = '';
                patch.campusCause = 'external_failed_to_hall';
            }
            const moved = await this.hall.transitionFrom(oCtx, orderIdNum, ['third_party'], patch);
            if (!moved) {
                core_2.Logger.warn(`订单 ${order.code} 外部失败回调忽略（订单已取消或状态已变更）`, loggerCtx);
                return;
            }
            // §4/§6：异常态顾客可见（不是静默降级），失败原因与后续重新派送都算配送方式调整
            if (update.status === 'exception') {
                this.notify.user(oCtx, order.id, 'deliveryFallback', '运力异常，重新派送');
            }
            return;
        }
        // 中间态（pending/accepted/pickup）：条件写锚定读取时的状态，
        // 防并发乱序回调把已推进的状态回退（read-then-write 的丢更新）。
        const written = await this.writeThirdPartyPatch(orderIdNum, patch, current);
        if (!written) {
            core_2.Logger.warn(`订单 ${order.code} 回调 ${update.status} 写入跳过（状态已变更/已取消）`, loggerCtx);
            return;
        }
        if (update.status === 'accepted' || update.status === 'pickup') {
            // 外部快递接单/取货顾客通知：复用「骑手已接单」模板，
            // dedupe 后缀区分接单与取货两个节点，避免与出餐完成通知抢同一幂等键。
            const cfg = await this.cfgRepo.findOne({ where: { channelId: channelId } });
            this.notify.user(oCtx, order.id, 'riderAssigned', undefined, (_j = cfg === null || cfg === void 0 ? void 0 : cfg.h5BaseUrl) !== null && _j !== void 0 ? _j : undefined, `external_${update.status}`);
        }
    }
    /** 自营快递接单（R1 商户超时转自营 / R3 自营快递池） */
    async acceptOwned(ctx, orderId) {
        var _a;
        const order = await this.orderRepo(ctx).findOne({ where: { id: orderId } });
        if (!order)
            throw new core_2.UserInputError('订单不存在');
        const cf = order.customFields;
        if (!['pending_merchant', 'open', 'owned_pool'].includes(String((_a = cf.hallStatus) !== null && _a !== void 0 ? _a : ''))) {
            throw new core_2.UserInputError('订单当前状态不可由自营快递接单');
        }
        // 条件写：校验与写入原子化，与用户取消并发时不把已退款单改回 owned_dispatched
        const moved = await this.hall.transitionFrom(ctx, orderId, ['pending_merchant', 'open', 'owned_pool'], {
            deliveryPlan: 'owned',
            hallStatus: 'owned_dispatched',
            deliveryStatus: 'assigned', // 已接单未取餐：独立于在途(in_progress)的计时阶段
            assignedAt: new Date(),
            pickedUpAt: null,
            campusCause: 'owned_accepted',
        });
        if (!moved)
            throw new core_2.UserInputError('订单状态已变更（可能已取消），请刷新后重试');
        return { ok: true };
    }
    /** 自营快递确认取餐：assigned → in_progress + 写 pickedUpAt。
     * 条件写保证重复点击/并发取消时不会把已脱厅单改成在途；pickedUpAt 是在途时钟唯一锚点。 */
    async pickupOwned(_ctx, orderId) {
        const out = await this.connection.rawConnection.query(`UPDATE "order" SET ${cfColumn('deliveryStatus')} = $1, ${cfColumn('pickedUpAt')} = $2 `
            + `WHERE id = $3 AND COALESCE(${cfColumn('hallStatus')}, '') = 'owned_dispatched' `
            + `AND ${cfColumn('deliveryStatus')} = 'assigned' AND "state" <> 'Cancelled' RETURNING id`, ['in_progress', new Date(), orderId]);
        const rows = Array.isArray(out) && Array.isArray(out[0]) ? out[0] : out;
        if (!Array.isArray(rows) || !rows.length) {
            throw new core_2.UserInputError('订单当前状态不可确认取餐（需自营快递已接单未取餐）');
        }
        return { ok: true };
    }
    /** 第一段（商户 / 自营快递）送达校园交接点：R1/R2 进大厅接力，R3 直接完成 */
    async completeFirstLeg(ctx, orderId, cause) {
        var _a, _b, _c;
        const order = await this.orderRepo(ctx).findOne({ where: { id: orderId } });
        if (!order)
            throw new core_2.UserInputError('订单不存在');
        const cf = order.customFields;
        const route = String((_a = cf.fulfillmentRoute) !== null && _a !== void 0 ? _a : '');
        const plan = String((_b = cf.deliveryPlan) !== null && _b !== void 0 ? _b : '');
        if (!['merchant', 'owned'].includes(plan)) {
            throw new core_2.UserInputError('当前订单第一段不是商户/自营快递');
        }
        // 前置状态校验：只允许「本段配送中」的订单确认送达，防止重复调用把已进大厅/已送达的单
        // 再次 enterHallForHandover（重置 hallStatus、清空骑手、重生成交接码）
        const expectedStatus = plan === 'merchant' ? 'merchant_delivering' : 'owned_dispatched';
        if (String((_c = cf.hallStatus) !== null && _c !== void 0 ? _c : '') !== expectedStatus) {
            throw new core_2.UserInputError('第一段已送达或订单状态已变更，请刷新后重试');
        }
        if (route === 'R3') {
            // 条件写（仅本段配送中）：并发取消时不得把已退款单写成 delivered
            const done = await this.hall.transitionFrom(ctx, orderId, [expectedStatus], {
                hallStatus: 'delivered',
                deliveryStatus: 'delivered',
                deliveredAt: new Date(),
                handoverAt: new Date(),
                campusCause: cause,
            });
            if (!done)
                throw new core_2.UserInputError('第一段已送达或订单状态已变更，请刷新后重试');
            this.notify.user(ctx, order.id, 'orderDelivered');
            return { ok: true, done: true };
        }
        // 条件入厅（仅本段配送中），handoverAt/thirdPartyState 与入厅同语句落库
        const code = await this.hall.enterHallForHandover(ctx, orderId, cause, [expectedStatus], {
            handoverAt: new Date(),
            thirdPartyState: '',
        });
        if (!code)
            throw new core_2.UserInputError('第一段已送达或订单状态已变更，请刷新后重试');
        return { ok: true, done: false };
    }
};
exports.ThirdPartyDeliveryService = ThirdPartyDeliveryService;
exports.ThirdPartyDeliveryService = ThirdPartyDeliveryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_2.TransactionalConnection,
        hall_service_1.HallService,
        campus_notify_service_1.CampusNotifyService,
        core_1.ModuleRef])
], ThirdPartyDeliveryService);
//# sourceMappingURL=third-party-delivery.service.js.map