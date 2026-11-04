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
exports.PreSaleAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const pre_sale_service_1 = require("./pre-sale.service");
class PermissionError extends Error {
    constructor(code) {
        super(code);
        this.name = 'PermissionError';
    }
}
/** B2：租户营销活动专用写权限（在 dev-config customPermissions 中注册） */
const TENANT_PROMOTION_MANAGE = 'TenantPromotionManage';
let PreSaleAdminResolver = class PreSaleAdminResolver {
    constructor(preSaleService) {
        this.preSaleService = preSaleService;
    }
    /* ------------------------- 读（维持 Promotion 只读权限） ------------------------- */
    async preSaleActivities(ctx, options) {
        return this.preSaleService.findAll(ctx, options);
    }
    async preSaleActivity(ctx, id) {
        return this.preSaleService.findOne(ctx, id);
    }
    /* ------------------------- 写（超管 或 本渠道 TenantPromotionManage） ------------------------- */
    async createPreSaleActivity(ctx, input) {
        this.assertCanManage(ctx);
        // service.create 内部强制 channels=[ctx.channel] 且 channelId=ctx.channelId，不接受前端指定其它渠道
        return this.preSaleService.create(ctx, input);
    }
    async updatePreSaleActivity(ctx, input) {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, input.id);
        return this.preSaleService.update(ctx, input);
    }
    async deletePreSaleActivity(ctx, id) {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, id);
        await this.preSaleService.delete(ctx, id);
        return true;
    }
    /**
     * 到货（active/upcoming → delivered，开启尾款窗口）本质是活动状态写操作，
     * 因此按 B2 收紧为「超管 或 本渠道 TenantPromotionManage」，不再用订单权限 UpdateOrder 代偿。
     */
    async deliverPreSale(ctx, id) {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, id);
        return this.preSaleService.deliverPreSale(ctx, id);
    }
    /** 写权限门控：超管直通；其余必须持有 TenantPromotionManage（按当前渠道授权） */
    assertCanManage(ctx) {
        if (ctx.userHasPermissions([core_1.Permission.SuperAdmin]))
            return;
        if (!ctx.userHasPermissions([TENANT_PROMOTION_MANAGE])) {
            throw new PermissionError('PROMOTION_FORBIDDEN');
        }
    }
    /** 归属校验：非超管只能操作当前渠道的活动（channels 关联，旧数据回退 channelId 列） */
    async assertChannelAccess(ctx, id) {
        var _a;
        if (ctx.userHasPermissions([core_1.Permission.SuperAdmin]))
            return;
        const activity = await this.preSaleService.findOne(ctx, id);
        if (!activity) {
            throw new core_1.UserInputError(`PreSaleActivity with id ${id} not found`);
        }
        const channels = ((_a = activity.channels) !== null && _a !== void 0 ? _a : []);
        const byChannels = channels.some(c => String(c.id) === String(ctx.channelId));
        const byColumn = String(activity.channelId) === String(ctx.channelId);
        if (!byChannels && !byColumn) {
            throw new PermissionError('PROMOTION_CHANNEL_FORBIDDEN');
        }
    }
};
exports.PreSaleAdminResolver = PreSaleAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadPromotion),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PreSaleAdminResolver.prototype, "preSaleActivities", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadPromotion),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PreSaleAdminResolver.prototype, "preSaleActivity", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PreSaleAdminResolver.prototype, "createPreSaleActivity", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PreSaleAdminResolver.prototype, "updatePreSaleActivity", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PreSaleAdminResolver.prototype, "deletePreSaleActivity", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PreSaleAdminResolver.prototype, "deliverPreSale", null);
exports.PreSaleAdminResolver = PreSaleAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [pre_sale_service_1.PreSaleService])
], PreSaleAdminResolver);
//# sourceMappingURL=pre-sale-admin.resolver.js.map