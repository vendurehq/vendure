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
exports.FlashSaleAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const flash_sale_service_1 = require("./flash-sale.service");
class PermissionError extends Error {
    constructor(code) {
        super(code);
        this.name = 'PermissionError';
    }
}
/** B2：租户营销活动专用写权限（在 dev-config customPermissions 中注册） */
const TENANT_PROMOTION_MANAGE = 'TenantPromotionManage';
let FlashSaleAdminResolver = class FlashSaleAdminResolver {
    constructor(flashSaleService) {
        this.flashSaleService = flashSaleService;
    }
    /* ------------------------- 读（维持 Promotion 只读权限） ------------------------- */
    async flashSaleActivities(ctx, options) {
        return this.flashSaleService.findAll(ctx, options);
    }
    async flashSaleActivity(ctx, id) {
        return this.flashSaleService.findOne(ctx, id);
    }
    /* ------------------------- 写（超管 或 本渠道 TenantPromotionManage） ------------------------- */
    async createFlashSaleActivity(ctx, input) {
        this.assertCanManage(ctx);
        // service.create 内部强制 channels=[ctx.channel]，不接受前端指定其它渠道
        return this.flashSaleService.create(ctx, input);
    }
    async updateFlashSaleActivity(ctx, input) {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, input.id);
        return this.flashSaleService.update(ctx, input);
    }
    async deleteFlashSaleActivity(ctx, id) {
        this.assertCanManage(ctx);
        await this.assertChannelAccess(ctx, id);
        await this.flashSaleService.delete(ctx, id);
        return true;
    }
    /** 写权限门控：超管直通；其余必须持有 TenantPromotionManage（按当前渠道授权） */
    assertCanManage(ctx) {
        if (ctx.userHasPermissions([core_1.Permission.SuperAdmin]))
            return;
        if (!ctx.userHasPermissions([TENANT_PROMOTION_MANAGE])) {
            throw new PermissionError('PROMOTION_FORBIDDEN');
        }
    }
    /** 归属校验：非超管只能操作当前渠道的活动（防跨渠道 IDOR） */
    async assertChannelAccess(ctx, id) {
        var _a;
        if (ctx.userHasPermissions([core_1.Permission.SuperAdmin]))
            return;
        const activity = await this.flashSaleService.findOne(ctx, id);
        if (!activity) {
            throw new core_1.UserInputError(`FlashSaleActivity with id ${id} not found`);
        }
        const channels = ((_a = activity.channels) !== null && _a !== void 0 ? _a : []);
        if (!channels.some(c => String(c.id) === String(ctx.channelId))) {
            throw new PermissionError('PROMOTION_CHANNEL_FORBIDDEN');
        }
    }
};
exports.FlashSaleAdminResolver = FlashSaleAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadPromotion),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], FlashSaleAdminResolver.prototype, "flashSaleActivities", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadPromotion),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], FlashSaleAdminResolver.prototype, "flashSaleActivity", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], FlashSaleAdminResolver.prototype, "createFlashSaleActivity", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], FlashSaleAdminResolver.prototype, "updateFlashSaleActivity", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(core_1.Permission.Authenticated),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], FlashSaleAdminResolver.prototype, "deleteFlashSaleActivity", null);
exports.FlashSaleAdminResolver = FlashSaleAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [flash_sale_service_1.FlashSaleService])
], FlashSaleAdminResolver);
//# sourceMappingURL=flash-sale-admin.resolver.js.map