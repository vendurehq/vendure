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
exports.ShopOrderResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const generated_shop_types_1 = require("@vendure/common/lib/generated-shop-types");
const unique_1 = require("@vendure/common/lib/unique");
const error_result_1 = require("../../../common/error/error-result");
const errors_1 = require("../../../common/error/errors");
const generated_graphql_shop_errors_1 = require("../../../common/error/generated-graphql-shop-errors");
const utils_1 = require("../../../common/utils");
const config_1 = require("../../../config");
const transactional_connection_1 = require("../../../connection/transactional-connection");
const entity_1 = require("../../../entity");
const order_entity_1 = require("../../../entity/order/order.entity");
const service_1 = require("../../../service");
const customer_service_1 = require("../../../service/services/customer.service");
const order_service_1 = require("../../../service/services/order.service");
const session_service_1 = require("../../../service/services/session.service");
const request_context_1 = require("../../common/request-context");
const allow_decorator_1 = require("../../decorators/allow.decorator");
const relations_decorator_1 = require("../../decorators/relations.decorator");
const request_context_decorator_1 = require("../../decorators/request-context.decorator");
const transaction_decorator_1 = require("../../decorators/transaction.decorator");
let ShopOrderResolver = class ShopOrderResolver {
    constructor(orderService, customerService, sessionService, countryService, activeOrderService, configService, connection) {
        this.orderService = orderService;
        this.customerService = customerService;
        this.sessionService = sessionService;
        this.countryService = countryService;
        this.activeOrderService = activeOrderService;
        this.configService = configService;
        this.connection = connection;
    }
    availableCountries(ctx, args) {
        return this.countryService.findAllAvailable(ctx);
    }
    async order(ctx, args, relations) {
        const requiredRelations = ['customer', 'customer.user'];
        const order = await this.orderService.findOne(ctx, args.id, (0, unique_1.unique)([...relations, ...requiredRelations]));
        if (order && ctx.authorizedAsOwnerOnly) {
            const orderUserId = order.customer && order.customer.user && order.customer.user.id;
            if ((0, utils_1.idsAreEqual)(ctx.activeUserId, orderUserId)) {
                return order;
            }
            else {
                return;
            }
        }
    }
    async activeOrder(ctx, relations, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.findOne(ctx, sessionOrder.id, relations);
            }
            else {
                return;
            }
        }
    }
    async orderByCode(ctx, args, relations) {
        if (ctx.authorizedAsOwnerOnly) {
            const requiredRelations = ['customer', 'customer.user'];
            const order = await this.orderService.findOneByCode(ctx, args.code, (0, unique_1.unique)([...relations, ...requiredRelations]));
            if (order &&
                (await this.configService.orderOptions.orderByCodeAccessStrategy.canAccessOrder(ctx, order))) {
                return order;
            }
            // We throw even if the order does not exist, since giving a different response
            // opens the door to an enumeration attack to find valid order codes.
            throw new errors_1.ForbiddenError(config_1.LogLevel.Verbose);
        }
    }
    /**
     * 取消支付单。仅允许取消当前登录 Customer 自己的订单下的支付单，
     * 语义与 Admin API 的 cancelPayment 一致（走 PaymentMethodHandler.cancelPayment）。
     */
    async cancelPayment(ctx, args) {
        var _a, _b;
        if (!ctx.activeUserId) {
            throw new errors_1.ForbiddenError(config_1.LogLevel.Verbose);
        }
        const payment = await this.connection.getRepository(ctx, entity_1.Payment).findOne({
            where: { id: args.id },
            relations: ['order', 'order.customer'],
        });
        if (!payment || !payment.order) {
            throw new errors_1.EntityNotFoundError('Payment', args.id);
        }
        const ownerId = (_b = (_a = payment.order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id;
        if (!ownerId || !(0, utils_1.idsAreEqual)(ownerId, ctx.activeUserId)) {
            throw new errors_1.ForbiddenError(config_1.LogLevel.Verbose);
        }
        return this.orderService.cancelPayment(ctx, args.id);
    }
    async setOrderShippingAddress(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.setShippingAddress(ctx, sessionOrder.id, args.input);
            }
        }
        return new generated_graphql_shop_errors_1.NoActiveOrderError();
    }
    async setOrderBillingAddress(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.setBillingAddress(ctx, sessionOrder.id, args.input);
            }
        }
        return new generated_graphql_shop_errors_1.NoActiveOrderError();
    }
    async unsetOrderShippingAddress(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.unsetShippingAddress(ctx, sessionOrder.id);
            }
        }
        return new generated_graphql_shop_errors_1.NoActiveOrderError();
    }
    async unsetOrderBillingAddress(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.unsetBillingAddress(ctx, sessionOrder.id);
            }
        }
        return new generated_graphql_shop_errors_1.NoActiveOrderError();
    }
    async eligibleShippingMethods(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.getEligibleShippingMethods(ctx, sessionOrder.id);
            }
        }
        return [];
    }
    async eligiblePaymentMethods(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.getEligiblePaymentMethods(ctx, sessionOrder.id);
            }
        }
        return [];
    }
    async setOrderShippingMethod(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.setShippingMethod(ctx, sessionOrder.id, args.shippingMethodId);
            }
        }
        return new generated_graphql_shop_errors_1.NoActiveOrderError();
    }
    async setOrderCustomFields(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                return this.orderService.updateCustomFields(ctx, sessionOrder.id, args.input.customFields);
            }
        }
        return new generated_graphql_shop_errors_1.NoActiveOrderError();
    }
    async nextOrderStates(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
            return this.orderService.getNextOrderStates(sessionOrder);
        }
        return [];
    }
    async transitionOrderToState(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
            return await this.orderService.transitionToState(ctx, sessionOrder.id, args.state);
        }
    }
    async addItemToOrder(ctx, args, relations) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        return this.orderService.addItemToOrder(ctx, order.id, args.productVariantId, args.quantity, args.customFields, relations);
    }
    async addItemsToOrder(ctx, args) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        const result = await this.orderService.addItemsToOrder(ctx, order.id, args.inputs);
        return {
            order: result.order,
            errorResults: result.errorResults,
        };
    }
    async setCurrencyCodeForOrder(ctx, args, relations) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        return this.orderService.updateOrderCurrency(ctx, order.id, args.currencyCode, relations);
    }
    async adjustOrderLine(ctx, args, relations) {
        if (args.quantity === 0) {
            return this.removeOrderLine(ctx, { orderLineId: args.orderLineId });
        }
        const order = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        return this.orderService.adjustOrderLine(ctx, order.id, args.orderLineId, args.quantity, args.customFields, relations);
    }
    async removeOrderLine(ctx, args) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        return this.orderService.removeItemFromOrder(ctx, order.id, args.orderLineId);
    }
    async removeAllOrderLines(ctx, args) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        return this.orderService.removeAllItemsFromOrder(ctx, order.id);
    }
    async applyCouponCode(ctx, args) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        return this.orderService.applyCouponCode(ctx, order.id, args.couponCode);
    }
    async removeCouponCode(ctx, args) {
        const order = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME], true);
        return this.orderService.removeCouponCode(ctx, order.id, args.couponCode);
    }
    async addPaymentToOrder(ctx, args) {
        var _a;
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                const order = await this.orderService.addPaymentToOrder(ctx, sessionOrder.id, args.input);
                if ((0, error_result_1.isGraphQlErrorResult)(order)) {
                    return order;
                }
                if (order.active === false) {
                    await this.customerService.createAddressesForNewCustomer(ctx, order);
                }
                if (order.active === false && ((_a = ctx.session) === null || _a === void 0 ? void 0 : _a.activeOrderId) === sessionOrder.id) {
                    await this.sessionService.unsetActiveOrder(ctx, ctx.session);
                }
                return order;
            }
        }
        return new generated_graphql_shop_errors_1.NoActiveOrderError();
    }
    async setCustomerForOrder(ctx, args) {
        if (ctx.authorizedAsOwnerOnly) {
            const sessionOrder = await this.activeOrderService.getActiveOrder(ctx, args[config_1.ACTIVE_ORDER_INPUT_FIELD_NAME]);
            if (sessionOrder) {
                const { guestCheckoutStrategy } = this.configService.orderOptions;
                const result = await guestCheckoutStrategy.setCustomerForOrder(ctx, sessionOrder, args.input);
                if ((0, error_result_1.isGraphQlErrorResult)(result)) {
                    return result;
                }
                return this.orderService.addCustomerToOrder(ctx, sessionOrder.id, result);
            }
        }
        return new generated_graphql_shop_errors_1.NoActiveOrderError();
    }
};
exports.ShopOrderResolver = ShopOrderResolver;
__decorate([
    (0, graphql_1.Query)(),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "availableCountries", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __param(2, (0, relations_decorator_1.Relations)({ entity: order_entity_1.Order, omit: ['aggregateOrder', 'sellerOrders'] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object, Array]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "order", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, relations_decorator_1.Relations)({ entity: order_entity_1.Order, omit: ['aggregateOrder', 'sellerOrders'] })),
    __param(2, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Array, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "activeOrder", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __param(2, (0, relations_decorator_1.Relations)({ entity: order_entity_1.Order, omit: ['aggregateOrder', 'sellerOrders'] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object, Array]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "orderByCode", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "cancelPayment", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "setOrderShippingAddress", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "setOrderBillingAddress", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "unsetOrderShippingAddress", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "unsetOrderBillingAddress", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "eligibleShippingMethods", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "eligiblePaymentMethods", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "setOrderShippingMethod", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "setOrderCustomFields", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Query)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "nextOrderStates", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "transitionOrderToState", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __param(2, (0, relations_decorator_1.Relations)({ entity: order_entity_1.Order, omit: ['aggregateOrder', 'sellerOrders'] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object, Array]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "addItemToOrder", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "addItemsToOrder", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __param(2, (0, relations_decorator_1.Relations)({ entity: order_entity_1.Order, omit: ['aggregateOrder', 'sellerOrders'] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object, Array]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "setCurrencyCodeForOrder", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __param(2, (0, relations_decorator_1.Relations)({ entity: order_entity_1.Order, omit: ['aggregateOrder', 'sellerOrders'] })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object, Array]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "adjustOrderLine", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "removeOrderLine", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "removeAllOrderLines", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "applyCouponCode", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "removeCouponCode", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.UpdateOrder, generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "addPaymentToOrder", null);
__decorate([
    (0, transaction_decorator_1.Transaction)(),
    (0, graphql_1.Mutation)(),
    (0, allow_decorator_1.Allow)(generated_shop_types_1.Permission.Owner),
    __param(0, (0, request_context_decorator_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [request_context_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShopOrderResolver.prototype, "setCustomerForOrder", null);
exports.ShopOrderResolver = ShopOrderResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [order_service_1.OrderService,
        customer_service_1.CustomerService,
        session_service_1.SessionService,
        service_1.CountryService,
        service_1.ActiveOrderService,
        config_1.ConfigService,
        transactional_connection_1.TransactionalConnection])
], ShopOrderResolver);
//# sourceMappingURL=shop-order.resolver.js.map