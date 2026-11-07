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
exports.AddressChangeService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const core_2 = require("@vendure/core");
const wechat_subscribe_message_plugin_1 = require("@vendure/wechat-subscribe-message-plugin");
const typeorm_1 = require("typeorm");
const campus_address_change_entity_1 = require("./campus-address-change.entity");
const campus_building_entity_1 = require("./campus-building.entity");
const campus_fulfillment_config_entity_1 = require("./campus-fulfillment-config.entity");
const campus_zone_entity_1 = require("./campus-zone.entity");
const capacity_service_1 = require("./capacity.service");
const feishu_notify_service_1 = require("./feishu/feishu-notify.service");
const hall_service_1 = require("./hall.service");
const campus_notify_service_1 = require("./campus-notify.service");
const refund_payment_1 = require("./refund-payment");
const shipping_calculator_1 = require("./shipping-calculator");
const dynamic_pricing_1 = require("./dynamic-pricing");
const route_matrix_1 = require("./route-matrix");
const refund_lock_1 = require("./refund-lock");
const third_party_delivery_service_1 = require("./third-party-delivery.service");
const loggerCtx = 'CampusAddressChange';
/** 外部配送已接单/取货后不可改址 */
const THIRD_PARTY_LOCKED = ['accepted', 'pickup', 'delivered'];
/**
 * H4 未结清补差闸门：自助改址不阻断当前订单履约（先服务后补差），
 * 但「其它订单」累计未结清补差达到上限后必须先结清，避免反复改到高价分区后欠费累积。
 */
const MAX_UNPAID_DIFF_CENTS = 1000; // ¥10
const MAX_UNPAID_DIFF_ROWS = 3;
let AddressChangeService = class AddressChangeService {
    constructor(connection, orderService, customerService, capacity, notify, thirdParty, moduleRef, hall, feishu) {
        this.connection = connection;
        this.orderService = orderService;
        this.customerService = customerService;
        this.capacity = capacity;
        this.notify = notify;
        this.thirdParty = thirdParty;
        this.moduleRef = moduleRef;
        this.hall = hall;
        this.feishu = feishu;
    }
    /** 顾客自助改址（取货前、可跨分区）。差额不阻塞改址，写入台账待运营结算。 */
    async changeByCustomer(ctx, input) {
        if (!ctx.activeUserId)
            throw new core_2.ForbiddenError();
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer)
            throw new core_2.ForbiddenError();
        const locked = await (0, refund_lock_1.withAddressLock)(this.connection, input.orderId, async () => {
            var _a, _b;
            // 锁内重读：并发双击/两个标签页同时改址时，后到者必须基于最新地址与最新运费计算差额
            const order = await this.loadOrder(ctx, input.orderId);
            if (((_a = order.customer) === null || _a === void 0 ? void 0 : _a.id) !== customer.id)
                throw new core_2.ForbiddenError();
            this.assertNotCancelledOrDelivered(order);
            const cf = ((_b = order.customFields) !== null && _b !== void 0 ? _b : {});
            if (cf.deliveryStatus === 'in_progress' || cf.pickedUpAt)
                throw new core_2.UserInputError('骑手已取货，无法自助改址，请联系客服');
            if (THIRD_PARTY_LOCKED.includes(cf.thirdPartyState))
                throw new core_2.UserInputError('外部配送已接单，无法自助改址');
            await this.assertNoUnpaidDiff(ctx, customer.id, Number(order.id));
            const { zone, building } = await this.resolveTarget(ctx, input.zoneId, input.buildingId);
            return this.applyChange(ctx, order, zone, building, input.detail, {
                source: 'customer',
                reason: null,
                changedBy: ctx.activeUserId,
                customerId: customer.id,
            });
        });
        if (!locked.ok)
            throw new core_2.UserInputError('该订单正在处理其他改址，请稍后重试');
        return locked.value;
    }
    /**
     * 运营代客改址：C 端取货后锁死，运营可代改（必须填原因，全程留痕）。
     * 仅「已取消 / 已送达」拒绝；骑手取货、外部已接单均允许代改。
     */
    async adminChange(ctx, input) {
        var _a;
        const reason = ((_a = input.reason) !== null && _a !== void 0 ? _a : '').trim();
        if (!reason)
            throw new core_2.UserInputError('请填写代改原因');
        const locked = await (0, refund_lock_1.withAddressLock)(this.connection, input.orderId, async () => {
            var _a, _b, _c;
            const order = await this.loadOrder(ctx, input.orderId);
            if (Number(this.channelIdOf(order, ctx)) !== Number(ctx.channelId))
                throw new core_2.ForbiddenError();
            this.assertNotCancelledOrDelivered(order);
            const { zone, building } = await this.resolveTarget(ctx, input.zoneId, input.buildingId);
            return this.applyChange(ctx, order, zone, building, input.detail, {
                source: 'admin',
                reason,
                changedBy: ((_a = ctx.activeUserId) !== null && _a !== void 0 ? _a : null),
                customerId: ((_c = (_b = order.customer) === null || _b === void 0 ? void 0 : _b.id) !== null && _c !== void 0 ? _c : null),
            });
        });
        if (!locked.ok)
            throw new core_2.UserInputError('该订单正在处理其他改址，请稍后重试');
        return locked.value;
    }
    /** 改址差额试算（运营端预览：不写台账、不改订单） */
    async quote(ctx, orderId, zoneId) {
        var _a;
        const order = await this.loadOrder(ctx, orderId);
        if (Number(this.channelIdOf(order, ctx)) !== Number(ctx.channelId))
            throw new core_2.ForbiddenError();
        this.assertNotCancelledOrDelivered(order);
        const zone = await this.connection.getRepository(ctx, campus_zone_entity_1.CampusZone).findOne({ where: { id: zoneId } });
        if (!zone)
            throw new core_2.UserInputError('分区不存在');
        if (Number(zone.channelId) !== Number(ctx.channelId))
            throw new core_2.ForbiddenError();
        const channelId = this.channelIdOf(order, ctx);
        const cfg = await this.connection.rawConnection.getRepository(campus_fulfillment_config_entity_1.CampusFulfillmentConfig).findOne({
            where: { channelId: channelId },
        });
        const oldFee = await this.effectiveOldFee(ctx, order);
        const q = await (0, shipping_calculator_1.quoteZoneFee)(this.connection, channelId, { name: zone.name, fee: Number(zone.fee) }, cfg, order);
        const newFee = Number((_a = q === null || q === void 0 ? void 0 : q.price) !== null && _a !== void 0 ? _a : oldFee);
        const buildings = await this.connection
            .getRepository(ctx, campus_building_entity_1.CampusBuilding)
            .find({ where: { zoneId: zone.id, channelId: channelId } });
        return {
            oldFee,
            newFee,
            diff: newFee - oldFee,
            zoneId: zone.id,
            zoneName: zone.name,
            buildings,
        };
    }
    /** 顾客端：本单最近一次改址（差额状态感知，含已结清） */
    async myLatest(ctx, orderId) {
        var _a;
        if (!ctx.activeUserId)
            throw new core_2.ForbiddenError();
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer)
            throw new core_2.ForbiddenError();
        const order = await this.loadOrder(ctx, orderId);
        if (((_a = order.customer) === null || _a === void 0 ? void 0 : _a.id) !== customer.id)
            throw new core_2.ForbiddenError();
        const row = await this.connection
            .getRepository(ctx, campus_address_change_entity_1.CampusAddressChange)
            .findOne({ where: { orderId: Number(order.id) }, order: { createdAt: 'DESC' } });
        if (!row)
            return null;
        return {
            id: row.id,
            diff: row.diff,
            status: row.status,
            settleAction: row.settleAction,
            fromZone: row.fromZone,
            fromBuilding: row.fromBuilding,
            toZone: row.toZone,
            toBuilding: row.toBuilding,
            createdAt: row.createdAt,
        };
    }
    /** 动态计价预览：当前供需 + 各分区试算拆解（后台配置页用） */
    async dynamicPreview(ctx) {
        var _a, _b;
        const channelId = ctx.channelId;
        const cfg = await this.connection.rawConnection.getRepository(campus_fulfillment_config_entity_1.CampusFulfillmentConfig).findOne({
            where: { channelId: channelId },
        });
        const pricing = (0, dynamic_pricing_1.parseDynamicPricing)((_a = cfg === null || cfg === void 0 ? void 0 : cfg.dynamicPricing) !== null && _a !== void 0 ? _a : null);
        const zones = (await this.connection.rawConnection.getRepository(campus_zone_entity_1.CampusZone).find({
            where: { channelId: channelId },
            order: { id: 'ASC' },
        }));
        const backlog = pricing.enabled && pricing.supply ? await (0, shipping_calculator_1.readHallBacklog)(this.connection, channelId) : 0;
        const onlineRiders = (await this.capacity.listOnlineRiders(ctx)).length;
        const now = new Date();
        // 非分区口径：R5 跑腿起步价（未配置按默认 200）、R2 第三方到校基价（未配置不接管）
        const quoteBase = (key, raw, fallback) => {
            const base = raw !== null && raw !== void 0 ? raw : fallback;
            if (base == null)
                return null;
            const q = (0, dynamic_pricing_1.quoteDynamicFee)({ baseFee: Number(base), config: pricing, at: now, backlog, onlineRiders });
            return {
                key,
                configured: raw != null,
                baseFee: q.baseFee,
                price: q.price,
                addFee: q.addFee,
                breakdown: q.breakdown,
            };
        };
        return {
            at: now.toISOString(),
            enabled: pricing.enabled,
            backlog,
            onlineRiders,
            manualMultiplier: pricing.manualMultiplier,
            maxAddFee: pricing.maxAddFee,
            errand: quoteBase('errand', cfg === null || cfg === void 0 ? void 0 : cfg.errandBaseFee, 200),
            thirdParty: quoteBase('third-party', cfg === null || cfg === void 0 ? void 0 : cfg.thirdPartyBaseFee, null),
            supply: pricing.supply
                ? {
                    backlogThreshold: pricing.supply.backlogThreshold,
                    riderThreshold: (_b = pricing.supply.riderThreshold) !== null && _b !== void 0 ? _b : null,
                    addFee: pricing.supply.addFee,
                }
                : null,
            peakWindows: pricing.peakWindows,
            zones: zones.map(z => {
                const q = (0, dynamic_pricing_1.quoteDynamicFee)({
                    baseFee: Number(z.fee),
                    config: pricing,
                    at: now,
                    backlog,
                    onlineRiders,
                });
                return {
                    zoneId: z.id,
                    zoneName: z.name,
                    baseFee: q.baseFee,
                    price: q.price,
                    addFee: q.addFee,
                    breakdown: q.breakdown,
                };
            }),
        };
    }
    async list(ctx, opts = {}) {
        var _a, _b;
        const qb = this.connection
            .getRepository(ctx, campus_address_change_entity_1.CampusAddressChange)
            .createQueryBuilder('r')
            .where('r.channelId = :cid', { cid: ctx.channelId })
            .orderBy('r.createdAt', 'DESC')
            .skip(Math.max(0, (_a = opts.skip) !== null && _a !== void 0 ? _a : 0))
            .take(Math.min((_b = opts.take) !== null && _b !== void 0 ? _b : 50, 200));
        if (opts.status)
            qb.andWhere('r.status = :st', { st: opts.status });
        if (opts.orderId != null)
            qb.andWhere('r.orderId = :oid', { oid: Number(opts.orderId) });
        return qb.getMany();
    }
    async stats(ctx) {
        const rows = await this.connection
            .getRepository(ctx, campus_address_change_entity_1.CampusAddressChange)
            .createQueryBuilder('r')
            .select('r.status', 'status')
            .addSelect('COUNT(*)', 'cnt')
            .addSelect('COALESCE(SUM(CASE WHEN r.diff > 0 THEN r.diff ELSE 0 END), 0)', 'collect')
            .addSelect('COALESCE(SUM(CASE WHEN r.diff < 0 THEN -r.diff ELSE 0 END), 0)', 'refund')
            .where('r.channelId = :cid', { cid: ctx.channelId })
            .groupBy('r.status')
            .getRawMany();
        let pendingCount = 0;
        let pendingCollect = 0;
        let pendingRefund = 0;
        let total = 0;
        for (const r of rows) {
            const cnt = Number(r.cnt) || 0;
            total += cnt;
            if (r.status === 'pending') {
                pendingCount += cnt;
                pendingCollect += Number(r.collect) || 0;
                pendingRefund += Number(r.refund) || 0;
            }
        }
        return {
            total,
            pendingCount,
            pendingCollect,
            pendingRefund,
        };
    }
    /** 运营结清：refund=真实退款 / collect=补收（必须填凭证）/ waive=免收 / pending=撤销结清 */
    async settle(ctx, id, action, note) {
        var _a;
        if (!['refund', 'collect', 'waive', 'pending'].includes(action)) {
            throw new core_2.UserInputError('无效的结清动作');
        }
        const repo = this.connection.getRepository(ctx, campus_address_change_entity_1.CampusAddressChange);
        const row = await repo.findOne({ where: { id: id } });
        if (!row)
            throw new core_2.UserInputError('台账记录不存在');
        if (Number(row.channelId) !== Number(ctx.channelId))
            throw new core_2.ForbiddenError();
        const trimmed = (note !== null && note !== void 0 ? note : '').trim();
        // settleNote 列为 varchar(255)：超长会触发数据库写入失败，提前拦截
        if (trimmed.length > 200)
            throw new core_2.UserInputError('结清备注不能超过 200 字');
        if (action === 'pending') {
            if (row.refundId)
                throw new core_2.UserInputError('该差额已实际退款，无法撤销结清');
            row.status = 'pending';
            row.settledAt = null;
            row.settledBy = null;
            row.settleAction = null;
            row.settleNote = null;
        }
        else {
            if (action === 'collect') {
                if (Number(row.diff) <= 0)
                    throw new core_2.UserInputError('本单无待补收差额，无需补收');
                if (!trimmed)
                    throw new core_2.UserInputError('请填写补收凭证（收款方式或流水号）');
            }
            if (action === 'refund') {
                if (Number(row.diff) >= 0)
                    throw new core_2.UserInputError('本单不是待退差额，不能按已退款结清');
                if (row.refundId)
                    throw new core_2.UserInputError('该差额已退款，请勿重复操作');
                const amount = Math.abs(Number(row.diff));
                if (amount > 0) {
                    // 与商家拒单/T4/异常处置共用订单级退款锁，锁内复查防并发双退；
                    // 台账 refundId 必须在锁内与退款单同临界区落库（CAS：refundId IS NULL），
                    // 否则退款已打款而台账保存失败时会再次退款。
                    const done = await (0, refund_lock_1.withRefundLock)(this.connection, Number(row.orderId), async () => {
                        var _a, _b;
                        const fresh = await repo.findOne({ where: { id: id } });
                        if (!fresh)
                            throw new core_2.UserInputError('台账记录不存在');
                        if (fresh.refundId)
                            throw new core_2.UserInputError('该差额已退款，请勿重复操作');
                        const order = await this.loadOrder(ctx, row.orderId);
                        const refund = await this.refundAmount(ctx, order, amount, `address change refund (${row.orderCode})`);
                        const saved = await repo.update({ id: id, refundId: (0, typeorm_1.IsNull)() }, {
                            refundId: refund.id,
                            status: 'settled',
                            settledAt: new Date(),
                            settledBy: ((_a = ctx.activeUserId) !== null && _a !== void 0 ? _a : null),
                            settleAction: 'refund',
                            settleNote: trimmed || null,
                        });
                        if (!Number((_b = saved === null || saved === void 0 ? void 0 : saved.affected) !== null && _b !== void 0 ? _b : 0)) {
                            throw new core_2.UserInputError('该差额已退款，请勿重复操作');
                        }
                    });
                    if (!done.ok)
                        throw new core_2.UserInputError('该订单正在退款处理中，请稍后重试');
                    return repo.findOne({ where: { id: id } });
                }
            }
            row.status = 'settled';
            row.settledAt = new Date();
            row.settledBy = ((_a = ctx.activeUserId) !== null && _a !== void 0 ? _a : null);
            row.settleAction = action;
            row.settleNote = trimmed || null;
        }
        return repo.save(row);
    }
    /** 部分退款（fork 无 core RefundService，走 OrderService.refundOrder/settleRefund，与 dispatch-admin 同源）。
     * refund 表 shipping/adjustment 列 NOT NULL 必须显式传 0；超额退款抛错。 */
    async refundAmount(ctx, order, amount, reason) {
        var _a;
        // 只认 Settled/Authorized 且仍有余额的支付单，避免选中失败重试单导致退款失败
        const payments = await (0, refund_payment_1.refundablePayments)(this.connection, Number(order.id));
        if (!payments.length)
            throw new core_2.UserInputError('订单无可退支付余额（可能未支付或已全额退款）');
        const picked = payments.find(p => p.remaining >= amount);
        if (!picked)
            throw new core_2.UserInputError('退款金额超过可退余额（订单可能已全额退款）');
        const created = await this.orderService.refundOrder(ctx, {
            paymentId: picked.payment.id,
            amount,
            shipping: 0,
            adjustment: 0,
            reason,
        });
        if (!created || created.errorCode) {
            throw new core_2.UserInputError(`退款失败：${(_a = created === null || created === void 0 ? void 0 : created.errorCode) !== null && _a !== void 0 ? _a : '未知原因'}`);
        }
        // 结算失败必须把退款单置 Failed（与商家拒单/T4/异常处置同一口径），
        // 否则该 Pending 单仍占已退额度，后续重试/拒单退款会少退。
        await (0, refund_payment_1.settleRefundOrMarkFailed)(this.connection, this.orderService, ctx, created.id);
        return created;
    }
    /**
     * H4：自助改址前的未结清补差闸门。
     * 只统计「其它订单」的待补收差额（本单连续改址允许，顾客改错后仍可纠正），
     * 累计金额或笔数超限时要求先结清，防止反复改到高价分区后一直欠费。
     */
    async assertNoUnpaidDiff(ctx, customerId, orderId) {
        const rows = await this.connection.getRepository(ctx, campus_address_change_entity_1.CampusAddressChange).find({
            where: {
                channelId: ctx.channelId,
                customerId: customerId,
                status: 'pending',
            },
        });
        const owed = rows.filter(r => { var _a; return Number(r.orderId) !== orderId && Number((_a = r.diff) !== null && _a !== void 0 ? _a : 0) > 0; });
        const owedSum = owed.reduce((sum, r) => { var _a; return sum + Number((_a = r.diff) !== null && _a !== void 0 ? _a : 0); }, 0);
        if (owedSum >= MAX_UNPAID_DIFF_CENTS || owed.length >= MAX_UNPAID_DIFF_ROWS) {
            throw new core_2.UserInputError('有未结清的改址差价，请先联系客服结清后再修改地址');
        }
    }
    async loadOrder(ctx, orderId) {
        const order = await this.connection
            .getRepository(ctx, core_2.Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.channels', 'channel')
            .leftJoinAndSelect('order.customer', 'customer')
            .where('order.id = :id', { id: orderId })
            .getOne();
        if (!order)
            throw new core_2.UserInputError('订单不存在');
        return order;
    }
    assertNotCancelledOrDelivered(order) {
        var _a;
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        if (order.state === 'Cancelled')
            throw new core_2.UserInputError('订单已取消，无法改址');
        if (cf.deliveredAt)
            throw new core_2.UserInputError('订单已送达，无法改址');
    }
    async resolveTarget(ctx, zoneId, buildingId) {
        const zone = await this.connection.getRepository(ctx, campus_zone_entity_1.CampusZone).findOne({
            where: { id: zoneId },
        });
        if (!zone)
            throw new core_2.UserInputError('分区不存在');
        // 跨店守卫：分区/楼栋必须属于当前店铺，防止改址到别家渠道的地址
        if (Number(zone.channelId) !== Number(ctx.channelId))
            throw new core_2.UserInputError('分区不属于当前店铺');
        const building = await this.connection.getRepository(ctx, campus_building_entity_1.CampusBuilding).findOne({
            where: { id: buildingId },
        });
        if (!building)
            throw new core_2.UserInputError('宿舍楼不存在');
        if (Number(building.zoneId) !== Number(zone.id))
            throw new core_2.UserInputError('楼栋不属于所选分区');
        if (Number(building.channelId) !== Number(zone.channelId))
            throw new core_2.UserInputError('楼栋不属于所选分区');
        return { zone, building };
    }
    async applyChange(ctx, order, zone, building, detail, actor) {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
        const channelId = this.channelIdOf(order, ctx);
        const cfg = await this.connection.rawConnection.getRepository(campus_fulfillment_config_entity_1.CampusFulfillmentConfig).findOne({
            where: { channelId: channelId },
        });
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        // 差额基准必须取「上一次改址后的生效运费」：order.shippingWithTax 是下单快照且从不回写，
        // 连续改址（A→B→A）会重复记差额。无改址史时退回下单快照。
        const oldFee = await this.effectiveOldFee(ctx, order);
        const quote = await (0, shipping_calculator_1.quoteZoneFee)(this.connection, channelId, { name: zone.name, fee: Number(zone.fee) }, cfg, order);
        const newFee = Number((_b = quote === null || quote === void 0 ? void 0 : quote.price) !== null && _b !== void 0 ? _b : oldFee);
        const diff = newFee - oldFee;
        const fromZone = String((_c = cf.campusZone) !== null && _c !== void 0 ? _c : '');
        const fromBuilding = String((_d = cf.buildingId) !== null && _d !== void 0 ? _d : '');
        const fromDetail = (_e = cf.deliveryDetail) !== null && _e !== void 0 ? _e : null;
        const toDetail = (detail === null || detail === void 0 ? void 0 : detail.trim()) || fromDetail;
        const route = String((_f = cf.fulfillmentRoute) !== null && _f !== void 0 ? _f : '');
        const hallStatus = String((_g = cf.hallStatus) !== null && _g !== void 0 ? _g : '');
        // 交接点快照联动：R1/R2 按新楼栋坐标重选最近交接点（未配置交接点时为 null，保留旧快照）。
        // 餐已实到交接点（open）或已被骑手取走（grabbed/delivered）时不改快照，否则会把骑手指向错误位置。
        const atHandoverPoint = ['open', 'grabbed', 'delivered'].includes(hallStatus);
        const point = (route === 'R1' || route === 'R2') && cfg && !atHandoverPoint
            ? (0, route_matrix_1.resolveHandoverPoint)(route, cfg, building.lat != null && building.lng != null
                ? { lat: Number(building.lat), lng: Number(building.lng) }
                : null)
            : null;
        const record = await this.connection.getRepository(ctx, campus_address_change_entity_1.CampusAddressChange).save(new campus_address_change_entity_1.CampusAddressChange({
            channelId,
            orderId: Number(order.id),
            orderCode: order.code,
            customerId: actor.customerId,
            fromZone,
            fromBuilding,
            fromDetail,
            toZone: zone.name,
            toBuilding: building.name,
            toDetail,
            oldFee,
            newFee,
            diff,
            status: diff === 0 ? 'settled' : 'pending',
            settledAt: diff === 0 ? new Date() : null,
            settleAction: diff === 0 ? 'waive' : null,
            source: actor.source,
            reason: actor.reason,
            changedBy: actor.changedBy,
        }));
        try {
            await this.orderService.updateCustomFields(ctx, order.id, Object.assign({ buildingId: String(building.id), campusZone: zone.name, deliveryDetail: toDetail }, (point
                ? {
                    handoverPointName: point.name,
                    handoverPointAddress: (_h = point.address) !== null && _h !== void 0 ? _h : null,
                    handoverPointLat: point.lat,
                    handoverPointLng: point.lng,
                }
                : {})));
        }
        catch (e) {
            // 订单地址未改成功时台账不得残留：否则会留下「已改址待补差额」幽灵记录，
            // 运营按台账退款/补收却从未真正改址。
            await this.connection
                .getRepository(ctx, campus_address_change_entity_1.CampusAddressChange)
                .delete(record.id)
                .catch((err) => {
                var _a;
                return core_2.Logger.error(`address change: rollback record ${record.id} failed for ${order.code}: ${(_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : err}`, loggerCtx);
            });
            throw e;
        }
        // 已指派骑手在途 / R1 商户自配送：改址必须触达实际履约方，否则仍按旧地址送达。
        // campusCause 供调度墙展示；骑手订阅消息复用渠道 orderShippedTemplateId（同入厅提醒口径）。
        const riderId = String((_j = cf.deliveryStaffId) !== null && _j !== void 0 ? _j : '');
        const merchantSelfDelivery = route === 'R1';
        if (riderId || merchantSelfDelivery) {
            await this.orderService.updateCustomFields(ctx, order.id, { campusCause: 'address_changed' });
        }
        if (riderId) {
            this.notifyRiderAddressChanged(ctx, order, riderId, zone, building);
        }
        if (merchantSelfDelivery) {
            this.notifyMerchantAddressChanged(ctx, order, record.id, zone, building);
        }
        // 外部快递在途（已接单/已取货）：旧运单目的地已失效，取消后回待推送，由运营按新址重推。
        // 未推送（pending_dispatch/未入 third_party）无需处理，重推时自然读取新址。
        const tpState = String((_k = cf.thirdPartyState) !== null && _k !== void 0 ? _k : '');
        const externalInFlight = hallStatus === 'third_party'
            && String((_l = cf.deliveryPlan) !== null && _l !== void 0 ? _l : '') === 'external_courier'
            && ['pending', 'accepted', 'pickup'].includes(tpState);
        if (externalInFlight) {
            let cancelled = false;
            try {
                const res = await this.thirdParty.cancel(ctx, Number(order.id), 'address changed');
                cancelled = !!(res === null || res === void 0 ? void 0 : res.ok);
            }
            catch (e) {
                core_2.Logger.error(`address change: cancel external failed for ${order.code}: ${(_m = e === null || e === void 0 ? void 0 : e.message) !== null && _m !== void 0 ? _m : e}`, loggerCtx);
            }
            if (cancelled) {
                // cancel 按路线回落（R2 待推送 / R3 大厅且 deliveryPlan 改回 campus_rider）；
                // 改址场景统一恢复外部快递计划并回待推送，等运营按新址重推。
                // 条件写：与用户取消并发时不得把已退款单改回待推送（cancel 期间可能已脱厅）
                const moved = await this.hall.transitionFrom(ctx, Number(order.id), ['open', 'pending_dispatch', 'third_party'], {
                    hallStatus: 'pending_dispatch',
                    deliveryPlan: 'external_courier',
                    handoverMode: route === 'R2' ? 'to_campus_rider' : 'direct_to_user',
                    thirdPartyState: 'cancelled',
                    thirdPartyDispatchAt: new Date(),
                    exceptionResolvedAt: null,
                    campusCause: 'address_changed_repush',
                });
                if (!moved) {
                    core_2.Logger.warn(`address change: order ${order.code} already cancelled/left flow, skip repush reset`, loggerCtx);
                }
            }
            else {
                // 旧运单未确认取消：仍会按旧地址送达，新址无人处理。留痕给运营人工取消/改址，不可静默。
                await this.orderService.updateCustomFields(ctx, order.id, {
                    campusCause: 'address_change_cancel_failed',
                });
                core_2.Logger.error(`address change: external delivery for ${order.code} NOT cancelled, still routed to old address; manual follow-up required`, loggerCtx);
            }
        }
        core_2.Logger.info(`address change [${actor.source}] order=${order.code} ${fromZone}/${fromBuilding} -> ${zone.name}/${building.name} diff=${diff}`, loggerCtx);
        // 改址成功通知（fire-and-forget）：以台账记录 id 作幂等后缀，同一订单多次改址各推一条
        this.notify.user(ctx, order.id, 'addressChanged', `${zone.name}·${building.name}`, (_o = cfg === null || cfg === void 0 ? void 0 : cfg.h5BaseUrl) !== null && _o !== void 0 ? _o : undefined, String(record.id));
        return {
            diff,
            oldFee,
            newFee,
            fromZone,
            toZone: zone.name,
            recordId: record.id,
        };
    }
    /** 生效运费：最近一次改址落库的 newFee；无改址史回退下单快照 shippingWithTax */
    async effectiveOldFee(ctx, order) {
        var _a;
        const latest = await this.connection.getRepository(ctx, campus_address_change_entity_1.CampusAddressChange).findOne({
            where: { orderId: Number(order.id) },
            order: { createdAt: 'DESC', id: 'DESC' },
        });
        return latest ? Number(latest.newFee) : Number((_a = order.shippingWithTax) !== null && _a !== void 0 ? _a : 0);
    }
    /** R1 商户自配送改址：推管理群（商户履约方），避免商户仍按旧楼栋配送 */
    notifyMerchantAddressChanged(ctx, order, recordId, zone, building) {
        void this.feishu
            .pushEvent('campus_address_changed', '订单改址（商户自配送）', `订单 ${order.code} 收货地址改为 ${zone.name}·${building.name}，请按新地址配送`, order.code, String(recordId))
            .catch((e) => { var _a; return core_2.Logger.warn(`address change: merchant notify failed: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, loggerCtx); });
    }
    /** 改址定向提醒在途骑手（best-effort，失败不阻塞改址）：复用渠道 orderShippedTemplateId。 */
    notifyRiderAddressChanged(ctx, order, riderId, zone, building) {
        void (async () => {
            var _a, _b, _c;
            try {
                const templateId = ((_b = (_a = ctx.channel) === null || _a === void 0 ? void 0 : _a.customFields) !== null && _b !== void 0 ? _b : {}).orderShippedTemplateId;
                if (!templateId)
                    return;
                const msg = new core_2.Injector(this.moduleRef).get(wechat_subscribe_message_plugin_1.SubscribeMessageService);
                await msg.sendCustomMessage(ctx, riderId, templateId, {
                    orderCode: { value: order.code },
                    zone: { value: `${zone.name}·${building.name}` },
                });
            }
            catch (e) {
                core_2.Logger.warn(`address change: rider notify failed (${riderId}): ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, loggerCtx);
            }
        })();
    }
    channelIdOf(order, ctx) {
        var _a;
        const channels = order.channels;
        const own = (channels !== null && channels !== void 0 ? channels : []).find(c => c.code !== '__default_channel__');
        return ((_a = own === null || own === void 0 ? void 0 : own.id) !== null && _a !== void 0 ? _a : ctx.channelId);
    }
};
exports.AddressChangeService = AddressChangeService;
exports.AddressChangeService = AddressChangeService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_2.TransactionalConnection,
        core_2.OrderService,
        core_2.CustomerService,
        capacity_service_1.CapacityService,
        campus_notify_service_1.CampusNotifyService,
        third_party_delivery_service_1.ThirdPartyDeliveryService,
        core_1.ModuleRef,
        hall_service_1.HallService,
        feishu_notify_service_1.FeishuNotifyService])
], AddressChangeService);
//# sourceMappingURL=address-change.service.js.map