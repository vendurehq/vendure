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
exports.PickupGuestOrderResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const pickup_service_1 = require("./pickup.service");
const pickup_redemption_entity_1 = require("./pickup-redemption.entity");
const pickup_guest_order_1 = require("./pickup-guest-order");
const ERR_NOT_FOUND = 'GUEST_ORDER_NOT_FOUND';
let PickupGuestOrderResolver = class PickupGuestOrderResolver {
    constructor(orderService, configService, entityHydrator, productVariantService, connection, service) {
        this.orderService = orderService;
        this.configService = configService;
        this.entityHydrator = entityHydrator;
        this.productVariantService = productVariantService;
        this.connection = connection;
        this.service = service;
    }
    async guestOrderLookup(ctx, input) {
        const order = await this.loadOrder(ctx, input.orderCode);
        if (!order)
            throw new core_1.UserInputError(ERR_NOT_FOUND);
        const windowAccess = input.phone
            ? false
            : await this.configService.orderOptions.orderByCodeAccessStrategy.canAccessOrder(ctx, order);
        if (!(0, pickup_guest_order_1.guestLookupAllowed)(order, input, windowAccess).allowed) {
            throw new core_1.UserInputError(ERR_NOT_FOUND);
        }
        await this.service.ensurePickupRedemptionForOrder(ctx, order.id).catch(() => undefined);
        const redemption = await this.findRedemption(ctx, order.id);
        return (0, pickup_guest_order_1.buildGuestOverview)(order, redemption);
    }
    async guestSetOrderCustomFields(ctx, input) {
        var _a, _b, _c;
        const order = await this.loadOrder(ctx, input.orderCode);
        if (!order)
            throw new core_1.UserInputError(ERR_NOT_FOUND);
        const windowAccess = await this.configService.orderOptions.orderByCodeAccessStrategy.canAccessOrder(ctx, order);
        if (!windowAccess || !(0, pickup_guest_order_1.isGuestOrder)(order)) {
            throw new core_1.UserInputError(ERR_NOT_FOUND);
        }
        // 归属校验：订单已留存手机号时，必须与之一致；仅当订单尚无手机号时允许首次补录。
        // 防止仅凭 orderCode（可能被截图/员工看到）覆盖他人订单的联系方式。
        const existingPhone = String((_b = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.contactPhone) !== null && _b !== void 0 ? _b : '').trim();
        const nextPhone = String((_c = input.phone) !== null && _c !== void 0 ? _c : '').trim();
        if (!nextPhone || nextPhone.length > 20) {
            throw new core_1.UserInputError('手机号格式不正确');
        }
        const digits = (v) => v.replace(/\D/g, '');
        if (existingPhone && digits(existingPhone) !== digits(nextPhone)) {
            throw new core_1.UserInputError(ERR_NOT_FOUND);
        }
        await this.orderService.updateCustomFields(ctx, order.id, Object.assign({ contactPhone: nextPhone }, (input.name ? { contactName: input.name } : {})));
        const refreshed = (await this.loadOrder(ctx, input.orderCode));
        await this.service.ensurePickupRedemptionForOrder(ctx, refreshed.id).catch(() => undefined);
        const redemption = await this.findRedemption(ctx, refreshed.id);
        return (0, pickup_guest_order_1.buildGuestOverview)(refreshed, redemption);
    }
    async loadOrder(ctx, code) {
        var _a;
        // 先预载 lines 与 productVariant，EntityHydrator 才能沿 lines→productVariant→product 逐层落到 product
        const order = await this.orderService.findOneByCode(ctx, code, ['customer', 'customer.user', 'lines', 'lines.productVariant']);
        if (!order)
            return null;
        // relation 类型自定义字段与商品嵌套关系在 service 层默认不加载，
        // 用 EntityHydrator 显式灌注，供 buildGuestOverview 取取货点；商品名再用已翻译的 Product 确定性回填。
        await this.entityHydrator.hydrate(ctx, order, {
            relations: [
                'customFields.selectedPickupLocationId',
                'fulfillments',
            ],
        });
        for (const line of ((_a = order.lines) !== null && _a !== void 0 ? _a : [])) {
            const variant = line === null || line === void 0 ? void 0 : line.productVariant;
            if (variant && (variant.productId != null || variant.product)) {
                try {
                    const product = await this.productVariantService.getProductForVariant(ctx, variant);
                    if (product)
                        variant.product = product;
                }
                catch (_b) {
                    // 单个商品解析失败不阻塞概览构建
                }
            }
        }
        return order;
    }
    async findRedemption(ctx, orderId) {
        return this.connection
            .getRepository(ctx, pickup_redemption_entity_1.PickupRedemption)
            .findOne({ where: { orderId: orderId } });
    }
};
exports.PickupGuestOrderResolver = PickupGuestOrderResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PickupGuestOrderResolver.prototype, "guestOrderLookup", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PickupGuestOrderResolver.prototype, "guestSetOrderCustomFields", null);
exports.PickupGuestOrderResolver = PickupGuestOrderResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [core_1.OrderService,
        core_1.ConfigService,
        core_1.EntityHydrator,
        core_1.ProductVariantService,
        core_1.TransactionalConnection,
        pickup_service_1.PickupService])
], PickupGuestOrderResolver);
//# sourceMappingURL=pickup-guest-order.resolver.js.map