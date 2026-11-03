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
exports.MockAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const delivery_gateway_service_1 = require("./delivery-gateway.service");
let MockAdminResolver = class MockAdminResolver {
    constructor(deliveryGateway) {
        this.deliveryGateway = deliveryGateway;
    }
    async createDelivery(ctx, input) {
        const delivery = await this.deliveryGateway.createDelivery(ctx, input);
        return this.toGraphQl(delivery);
    }
    async deliveryOrders(ctx, orderId) {
        const list = await this.deliveryGateway.findByOrder(ctx, orderId);
        return list.map(d => this.toGraphQl(d));
    }
    async mockDeliveryEvent(ctx, deliveryOrderNo, status, courierName, courierPhone, reason) {
        await this.deliveryGateway.applyStatusEvent(ctx, {
            deliveryOrderNo,
            status: status,
            courierName,
            courierPhone,
            reason,
        });
        return true;
    }
    toGraphQl(d) {
        return {
            id: d.id,
            code: d.code,
            orderId: d.orderId,
            packageId: d.packageId,
            fulfillmentId: d.fulfillmentId,
            providerCode: d.providerCode,
            thirdPartyNo: d.thirdPartyNo,
            status: d.status,
            fee: d.fee,
            etaMinutes: d.etaMinutes,
            courierName: d.courierName,
            courierPhone: d.courierPhone,
            acceptedAt: d.acceptedAt,
            pickupAt: d.pickupAt,
            deliveredAt: d.deliveredAt,
            cancelledAt: d.cancelledAt,
            reason: d.reason,
        };
    }
};
exports.MockAdminResolver = MockAdminResolver;
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], MockAdminResolver.prototype, "createDelivery", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], MockAdminResolver.prototype, "deliveryOrders", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('deliveryOrderNo')),
    __param(2, (0, graphql_1.Args)('status')),
    __param(3, (0, graphql_1.Args)('courierName', { nullable: true })),
    __param(4, (0, graphql_1.Args)('courierPhone', { nullable: true })),
    __param(5, (0, graphql_1.Args)('reason', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], MockAdminResolver.prototype, "mockDeliveryEvent", null);
exports.MockAdminResolver = MockAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [delivery_gateway_service_1.DeliveryGatewayService])
], MockAdminResolver);
//# sourceMappingURL=mock-admin.resolver.js.map