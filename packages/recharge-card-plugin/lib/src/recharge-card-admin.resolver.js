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
exports.RechargeCardAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const recharge_card_service_1 = require("./recharge-card.service");
let RechargeCardAdminResolver = class RechargeCardAdminResolver {
    constructor(rechargeCardService) {
        this.rechargeCardService = rechargeCardService;
    }
    async rechargeCards(ctx, options = { take: 20 }) {
        // GraphQL 显式/nullable 缺省时 Nest 会传 null，参数默认值不生效，需二次兜底
        return this.rechargeCardService.findAll(ctx, options !== null && options !== void 0 ? options : { take: 20 });
    }
    async rechargeCardBatches(ctx, options = { take: 20 }) {
        return this.rechargeCardService.findAllBatches(ctx, options !== null && options !== void 0 ? options : { take: 20 });
    }
    async createRechargeCardBatch(ctx, input) {
        return this.rechargeCardService.createBatch(ctx, input);
    }
    async freezeRechargeCard(ctx, id) {
        return this.rechargeCardService.freezeCard(ctx, id);
    }
    async unfreezeRechargeCard(ctx, id) {
        return this.rechargeCardService.unfreezeCard(ctx, id);
    }
    async customerBalances(ctx, options) {
        return this.rechargeCardService.customerBalances(ctx, options);
    }
    async customerBalanceTransactions(ctx, customerId, options) {
        return this.rechargeCardService.customerBalanceTransactions(ctx, customerId, options);
    }
    async adminAdjustBalance(ctx, input) {
        const newBalance = await this.rechargeCardService.adminAdjustBalance(ctx, input);
        return {
            id: input.customerId,
            customerId: input.customerId,
            channelId: ctx.channelId,
            balance: newBalance,
            frozenBalance: 0,
        };
    }
};
exports.RechargeCardAdminResolver = RechargeCardAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadSettings),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RechargeCardAdminResolver.prototype, "rechargeCards", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadSettings),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RechargeCardAdminResolver.prototype, "rechargeCardBatches", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateSettings),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RechargeCardAdminResolver.prototype, "createRechargeCardBatch", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateSettings),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Number]),
    __metadata("design:returntype", Promise)
], RechargeCardAdminResolver.prototype, "freezeRechargeCard", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateSettings),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Number]),
    __metadata("design:returntype", Promise)
], RechargeCardAdminResolver.prototype, "unfreezeRechargeCard", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadSettings),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RechargeCardAdminResolver.prototype, "customerBalances", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadSettings),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('customerId')),
    __param(2, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Number, Object]),
    __metadata("design:returntype", Promise)
], RechargeCardAdminResolver.prototype, "customerBalanceTransactions", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateSettings),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], RechargeCardAdminResolver.prototype, "adminAdjustBalance", null);
exports.RechargeCardAdminResolver = RechargeCardAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [recharge_card_service_1.RechargeCardService])
], RechargeCardAdminResolver);
//# sourceMappingURL=recharge-card-admin.resolver.js.map