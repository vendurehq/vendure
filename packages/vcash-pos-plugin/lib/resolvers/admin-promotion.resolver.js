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
exports.AdminPromotionResolver = void 0;
const common_1 = require("@nestjs/common");
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const constants_1 = require("../constants");
const pos_session_service_1 = require("../services/pos-session.service");
const promotion_engine_service_1 = require("../services/promotion-engine.service");
const promotion_rule_service_1 = require("../services/promotion-rule.service");
/**
 * 促销规则管理 + 手动 reapply 入口。
 * 权限：CRUD 用 Settings 权限 + posSessionPermission；reapplyPromotion 用 posSessionPermission.Update
 */
let AdminPromotionResolver = class AdminPromotionResolver {
    constructor(ruleService, sessionService, orderService, promotionEngine) {
        this.ruleService = ruleService;
        this.sessionService = sessionService;
        this.orderService = orderService;
        this.promotionEngine = promotionEngine;
    }
    async promotionRules(ctx, channelId) {
        return this.ruleService.findAll(ctx, channelId ? parseInt(channelId, 10) : undefined);
    }
    async promotionRule(ctx, id) {
        return this.ruleService.findOne(ctx, parseInt(id, 10));
    }
    async createPromotionRule(ctx, input) {
        return this.ruleService.create(ctx, input);
    }
    async updatePromotionRule(ctx, input) {
        return this.ruleService.update(ctx, parseInt(input.id, 10), input);
    }
    async deletePromotionRule(ctx, id) {
        return this.ruleService.delete(ctx, parseInt(id, 10));
    }
    /**
     * 手动触发重新应用促销（管理员调试用）。
     * 通常 addPosItem 会自动 reapply，此接口便于规则变更后对存量订单重算。
     * 注意：手动 reapply 时 member 上下文从 order.customer 推断（无 session 时）。
     */
    async reapplyPromotion(ctx, orderId) {
        var _a;
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order)
            throw new core_1.UserInputError(`订单 ${orderId} 不存在`);
        // 手动 reapply：member 从 order.customer 推断（已结账订单可能无 session，但 order.customer 保留）
        return this.promotionEngine.reapply(ctx, { customer: (_a = order.customer) !== null && _a !== void 0 ? _a : null }, order);
    }
};
exports.AdminPromotionResolver = AdminPromotionResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadSettings, constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('channelId', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], AdminPromotionResolver.prototype, "promotionRules", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadSettings, constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], AdminPromotionResolver.prototype, "promotionRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.CreateSettings, constants_1.posSessionPermission.Create),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminPromotionResolver.prototype, "createPromotionRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateSettings, constants_1.posSessionPermission.Update),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminPromotionResolver.prototype, "updatePromotionRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.DeleteSettings, constants_1.posSessionPermission.Delete),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], AdminPromotionResolver.prototype, "deletePromotionRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminPromotionResolver.prototype, "reapplyPromotion", null);
exports.AdminPromotionResolver = AdminPromotionResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __param(0, (0, common_1.Inject)(promotion_rule_service_1.PromotionRuleService)),
    __param(1, (0, common_1.Inject)(pos_session_service_1.PosSessionService)),
    __param(2, (0, common_1.Inject)(core_1.OrderService)),
    __param(3, (0, common_1.Inject)(promotion_engine_service_1.PromotionEngineService)),
    __metadata("design:paramtypes", [promotion_rule_service_1.PromotionRuleService,
        pos_session_service_1.PosSessionService,
        core_1.OrderService,
        promotion_engine_service_1.PromotionEngineService])
], AdminPromotionResolver);
//# sourceMappingURL=admin-promotion.resolver.js.map