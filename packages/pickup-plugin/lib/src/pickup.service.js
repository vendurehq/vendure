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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PickupService = void 0;
const core_1 = require("@vendure/core");
const typeorm_1 = require("typeorm");
const common_1 = require("@nestjs/common");
const shop_plugin_1 = require("@vendure/shop-plugin");
const constants_1 = require("./constants");
const pickup_redemption_entity_1 = require("./pickup-redemption.entity");
const cod_collection_port_1 = require("./cod-collection-port");
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去易混淆 0/O1/I/L
// 到店收银（需人工确认收款）支付方式集合：下单时尚未收款，收款在提货当刻由店员确认。
// CO 到店付款/货到付款、固定聚合码收款均为到店收银；余额/线上等支付则视为已在线收款。
const ARRIVE_STORE_PAYMENT_METHODS = [
    'cash-on-delivery', // 货到付款/门店收银
    'fixed-aggregate-collection', // 固定聚合码收款（顾客扫门店固定码，店员确认到账）
];
let PickupService = class PickupService {
    constructor(options, connection, orderService, fulfillmentService, administratorService) {
        this.options = options;
        this.connection = connection;
        this.orderService = orderService;
        this.fulfillmentService = fulfillmentService;
        this.administratorService = administratorService;
    }
    genCode() {
        let code = '';
        for (let i = 0; i < 6; i++) {
            code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
        }
        return code;
    }
    async genUniqueCode(ctx) {
        for (let i = 0; i < 10; i++) {
            const code = this.genCode();
            const hit = await this.connection
                .getRepository(ctx, pickup_redemption_entity_1.PickupRedemption)
                .findOne({ where: { code } });
            if (!hit)
                return code;
        }
        throw new core_1.UserInputError('Failed to generate a unique pickup code');
    }
    async requireMyOrder(ctx, orderId) {
        var _a, _b;
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user', 'payments']);
        const uid = (_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id;
        if (!order || !uid || uid !== ctx.activeUserId) {
            throw new core_1.ForbiddenError();
        }
        return order;
    }
    async requireMyShop(ctx) {
        if (!ctx.activeUserId)
            throw new core_1.ForbiddenError();
        const admin = await this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
        if (!admin || admin.id == null)
            throw new core_1.ForbiddenError();
        const shop = await this.connection
            .getRepository(ctx, shop_plugin_1.Shop)
            .findOne({ where: { administratorId: admin.id } });
        if (!shop || shop.status !== 'active')
            throw new core_1.ForbiddenError();
        return shop;
    }
    /** 收款判定（唯一真源）：online 恒已收；cod 看人工 confirmation。 */
    effectiveCollected(redemption) {
        return redemption.paymentType === 'online' || redemption.collected === true;
    }
    /** 是否到店收银单（下单时未收款，需店员提货时确认收款）。 */
    isArriveStorePayment(payments) {
        return payments.some(p => ARRIVE_STORE_PAYMENT_METHODS.includes(p === null || p === void 0 ? void 0 : p.method));
    }
    /**
     * 核销码生成资格：deliveryType=pickup 且已过「加购/付款中」阶段。
     * online → 需已结算（PaymentSettled 及之后）；cod（到店付款/货到付款）→ 授权即视为可核销，
     * 收款在核销完成时由店员确认（解决 PaymentAuthorized 不生成码的问题）。
     */
    isPickupEligible(ctx, order) {
        var _a, _b, _c;
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        if (cf.deliveryType !== 'pickup')
            return false;
        if (((_b = order.totalWithTax) !== null && _b !== void 0 ? _b : 0) <= 0)
            return false;
        const ordering = ['AddingItems', 'ArrangingPayment', 'Draft', 'Cancelled'];
        if (ordering.includes(order.state))
            return false;
        const payments = ((_c = order.payments) !== null && _c !== void 0 ? _c : []);
        const cod = this.isArriveStorePayment(payments);
        if (cod)
            return true; // 到店付款：授权即有资格，收款后核销
        // online：需已结算
        const notPaid = [...ordering, 'PaymentAuthorized'];
        return !notPaid.includes(order.state);
    }
    /**
     * 店归属强校验：被核销订单主商品的 Product.customFields.shopId 归店（与 settlement-plugin 阶段24
     * 按店拆账同一判据）。订单任一行商品归属本店即视为本店单，否则不归属。
     */
    async orderBelongsToShop(ctx, orderId, shopId) {
        var _a;
        const order = await this.orderService.findOne(ctx, orderId, [
            'lines',
            'lines.productVariant',
            'lines.productVariant.product',
        ]);
        const lines = ((_a = order === null || order === void 0 ? void 0 : order.lines) !== null && _a !== void 0 ? _a : []);
        if (lines.length === 0) {
            return false;
        }
        return lines.some((l) => {
            var _a, _b, _c, _d;
            const sid = (_d = ((_c = (_b = (_a = l === null || l === void 0 ? void 0 : l.productVariant) === null || _a === void 0 ? void 0 : _a.product) === null || _b === void 0 ? void 0 : _b.customFields) !== null && _c !== void 0 ? _c : {})) === null || _d === void 0 ? void 0 : _d.shopId;
            return sid != null && Number(sid) === shopId;
        });
    }
    /** 懒生成/取回固定提货码（幂等：一生对一单）。 */
    async resolveMyPickupCode(ctx, orderId) {
        const order = await this.requireMyOrder(ctx, orderId);
        if (!this.isPickupEligible(ctx, order)) {
            throw new core_1.UserInputError('Order is not a paid pickup order');
        }
        return this.getOrCreateRedemption(ctx, order);
    }
    async getOrCreateRedemption(ctx, order) {
        var _a;
        const repo = this.connection.getRepository(ctx, pickup_redemption_entity_1.PickupRedemption);
        const existing = await repo.findOne({ where: { orderId: order.id } });
        if (existing)
            return existing;
        const code = await this.genUniqueCode(ctx);
        const payments = ((_a = order.payments) !== null && _a !== void 0 ? _a : []);
        const paymentType = this.isArriveStorePayment(payments) ? 'cod' : 'online';
        const entity = repo.create({
            channelId: ctx.channelId,
            orderId: order.id,
            code,
            status: 'generated',
            paymentType,
            collected: false,
        });
        const saved = await repo.save(entity);
        // 同步 Order.collected / paymentType（online 恒置已收；COD 收款在核销时再置）
        await this.orderService.updateCustomFields(ctx, order.id, {
            paymentType,
            collected: paymentType === 'online',
        });
        return saved;
    }
    /**
     * 为「已付款的 pickup 订单」幂等生成提货码（自动生码；供事件订阅与游客查询兜底调用）。
     * 非 pickup 或未过支付闸门（isPickupEligible：cod 授权即过）则不生成。
     */
    async ensurePickupRedemptionForOrder(ctx, orderId) {
        var _a;
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user', 'payments']);
        if (!order)
            return;
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        if (cf.deliveryType !== 'pickup')
            return;
        if (!this.isPickupEligible(ctx, order))
            return;
        await this.getOrCreateRedemption(ctx, order);
    }
    /** 核销闸门：校验凭据存在且 generated。 */
    async findGeneratable(ctx, orderId, code) {
        var _a;
        const repo = this.connection.getRepository(ctx, pickup_redemption_entity_1.PickupRedemption);
        const redemption = await repo.findOne({ where: { orderId: orderId } });
        if (!redemption)
            throw new core_1.UserInputError('Pickup code not found for order');
        if (redemption.status === 'void')
            throw new core_1.UserInputError('Pickup code has been voided');
        if (redemption.status === 'redeemed')
            throw new core_1.UserInputError('Pickup code already redeemed');
        if (redemption.code !== code)
            throw new core_1.UserInputError('Pickup code mismatch');
        const order = await this.orderService.findOne(ctx, orderId, ['fulfillments']);
        const shipped = ((_a = order === null || order === void 0 ? void 0 : order.fulfillments) !== null && _a !== void 0 ? _a : []).some(f => f.state === 'Shipped');
        if (!shipped)
            throw new core_1.UserInputError('Order not ready for pickup (not Shipped)');
        return [order, redemption];
    }
    /** 顾客自核销：仅线上已收款单可自助核销；到店付款单必须到店由店员收款核销（防漏收）。 */
    async claimMyPickup(ctx, orderId, code) {
        var _a;
        await this.requireMyOrder(ctx, orderId);
        const order = await this.orderService.findOne(ctx, orderId, ['payments']);
        const payments = ((_a = order === null || order === void 0 ? void 0 : order.payments) !== null && _a !== void 0 ? _a : []);
        if (this.isArriveStorePayment(payments)) {
            throw new core_1.UserInputError('该单为到店付款，请在到店时由店员核销');
        }
        return this.commitRedeem(ctx, orderId, code, 'customer');
    }
    /** 店员核销（仅本店订单，跨店抛 Forbidden）。到店付款单必须确认收款（collect=true）后才放行，防漏收。 */
    async claimPickupByShop(ctx, code, collect) {
        var _a;
        // 先取店主所属店作为归属上下文
        const shop = await this.requireMyShop(ctx);
        const repo = this.connection.getRepository(ctx, pickup_redemption_entity_1.PickupRedemption);
        const redemption = await repo.findOne({ where: { code } });
        if (!redemption)
            throw new core_1.UserInputError('Pickup code not found');
        // 店归属强校验：被核销订单主商品必须归本店，否则跨店核销拒绝。
        const owns = await this.orderBelongsToShop(ctx, redemption.orderId, shop.id);
        if (!owns) {
            throw new core_1.ForbiddenError();
        }
        if (redemption.status !== 'generated') {
            throw new core_1.UserInputError('Pickup code already used / voided');
        }
        const order = await this.orderService.findOne(ctx, redemption.orderId, ['payments']);
        const payments = ((_a = order === null || order === void 0 ? void 0 : order.payments) !== null && _a !== void 0 ? _a : []);
        const cod = this.isArriveStorePayment(payments);
        if (cod && collect !== true) {
            throw new core_1.UserInputError('该单为到店付款，请先确认收款后再核销');
        }
        const saved = await this.commitRedeem(ctx, redemption.orderId, code, 'shop', cod ? true : undefined);
        if (cod && collect === true) {
            await this.recordCodCollection(ctx, redemption.orderId, payments);
        }
        return saved;
    }
    /**
     * 到店自取 COD 柜台收款：核销完成后登记现金收款台账（金额=本单 COD 应收）。
     * 台账能力由 campus-delivery-plugin 注册；未安装时不阻断核销，仅告警由人工补录。
     */
    async recordCodCollection(ctx, orderId, payments) {
        var _a, _b;
        const codPayments = payments.filter(p => (p === null || p === void 0 ? void 0 : p.method) === 'cash-on-delivery');
        if (!codPayments.length)
            return;
        const port = (0, cod_collection_port_1.getCodCollectionPort)();
        if (!port) {
            core_1.Logger.warn(`COD 收款台账端口未注册，订单 ${orderId} 柜台收款未登记（需人工补录）`, 'Pickup');
            return;
        }
        const amount = codPayments.reduce((sum, p) => { var _a; return sum + Number((_a = p.amount) !== null && _a !== void 0 ? _a : 0); }, 0);
        try {
            await port.recordCounterCollection(ctx, orderId, {
                amount,
                collectedByUserId: (_a = ctx.activeUserId) !== null && _a !== void 0 ? _a : null,
            });
        }
        catch (e) {
            // 核销已提交，收款记录失败不回滚核销；退款侧会因缺收款记录而拦截，留痕待补录
            core_1.Logger.error(`COD 柜台收款登记失败（订单 ${orderId}，金额 ${amount} 分，需人工补录）：${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, 'Pickup');
        }
    }
    /** 店员核销凭据（到店或线上单通用）。仅设置 order.collected 与 redemption.collected。 */
    async commitRedeem(ctx, orderId, code, claimChannel, collected) {
        const [order, redemption] = await this.findGeneratable(ctx, orderId, code);
        const repo = this.connection.getRepository(ctx, pickup_redemption_entity_1.PickupRedemption);
        redemption.status = 'redeemed';
        redemption.claimedAt = new Date();
        redemption.claimedByUserId = ctx.activeUserId ? ctx.activeUserId : null;
        redemption.claimChannel = claimChannel;
        if (collected === true)
            redemption.collected = true;
        const saved = await repo.save(redemption);
        await this.connection.withTransaction(ctx, async (txCtx) => {
            var _a;
            await this.orderService.updateCustomFields(txCtx, orderId, {
                pickupClaimed: true,
                collected: collected === true ? true : undefined,
            });
            const withF = await this.orderService.findOne(txCtx, orderId, ['fulfillments']);
            for (const f of (_a = withF === null || withF === void 0 ? void 0 : withF.fulfillments) !== null && _a !== void 0 ? _a : []) {
                if (f.state === 'Shipped') {
                    await this.fulfillmentService.transitionToState(txCtx, f.id, 'Delivered');
                }
            }
        });
        return saved;
    }
    async onOrderCancelled(orderId) {
        // 由 plugin 订阅事件调用；用无 ctx 的连接
        const repo = this.connection.rawConnection.getRepository(pickup_redemption_entity_1.PickupRedemption);
        const r = await repo.findOne({ where: { orderId } });
        if (r && r.status === 'generated') {
            r.status = 'void';
            await repo.save(r);
        }
    }
    /** 店主域：本店待核销 pickup 凭据（generated，且订单主商品归本店）。返回 [items, totalItems] 供 resolver 解构。 */
    async myPickupOrders(ctx, options) {
        var _a, _b, _c;
        // 店主域：本店待核销 pickup 凭据（generated），且订单主商品归本店（判据与 claimPickupByShop /
        // myShopOrders 一致：任一订单行商品 Product.customFields.shopId 归本店）。跨渠道单（默认商城）同样可核销。
        const shop = await this.requireMyShop(ctx);
        const repo = this.connection.getRepository(ctx, pickup_redemption_entity_1.PickupRedemption);
        const [all] = await repo.findAndCount({ where: { status: 'generated' } });
        if (all.length === 0)
            return [[], 0];
        const shopId = shop.id;
        // 批量反查订单行商品归属，避免 N+1
        const orderIds = [...new Set(all.map(r => r.orderId))];
        const orders = await this.connection
            .getRepository(ctx, core_1.Order)
            .find({
            where: { id: (0, typeorm_1.In)(orderIds) },
            relations: ['lines', 'lines.productVariant', 'lines.productVariant.product'],
        });
        const owned = new Set();
        for (const o of orders) {
            const mine = ((_a = o === null || o === void 0 ? void 0 : o.lines) !== null && _a !== void 0 ? _a : []).some((l) => {
                var _a, _b, _c, _d;
                const sid = (_d = ((_c = (_b = (_a = l === null || l === void 0 ? void 0 : l.productVariant) === null || _a === void 0 ? void 0 : _a.product) === null || _b === void 0 ? void 0 : _b.customFields) !== null && _c !== void 0 ? _c : {})) === null || _d === void 0 ? void 0 : _d.shopId;
                return sid != null && Number(sid) === shopId;
            });
            if (mine)
                owned.add(o.id);
        }
        const items = all.filter(r => owned.has(r.orderId));
        const skip = (_b = options === null || options === void 0 ? void 0 : options.skip) !== null && _b !== void 0 ? _b : 0;
        const take = (_c = options === null || options === void 0 ? void 0 : options.take) !== null && _c !== void 0 ? _c : 20;
        return [items.slice(skip, skip + take), items.length];
    }
    async listRedemptions(ctx, options = {}, status) {
        var _a, _b;
        return this.connection
            .getRepository(ctx, pickup_redemption_entity_1.PickupRedemption)
            .findAndCount({
            where: Object.assign({}, (status ? { status } : {})),
            take: (_a = options === null || options === void 0 ? void 0 : options.take) !== null && _a !== void 0 ? _a : 20,
            skip: (_b = options === null || options === void 0 ? void 0 : options.skip) !== null && _b !== void 0 ? _b : 0,
        });
    }
    async allRedemptions(ctx, options) {
        const [items, totalItems] = await this.listRedemptions(ctx, options);
        return { items, totalItems };
    }
};
exports.PickupService = PickupService;
exports.PickupService = PickupService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(constants_1.PICKUP_PLUGIN_OPTIONS)),
    __metadata("design:paramtypes", [Object, core_1.TransactionalConnection,
        core_1.OrderService,
        core_1.FulfillmentService,
        core_1.AdministratorService])
], PickupService);
//# sourceMappingURL=pickup.service.js.map