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
exports.ShippingTemplateAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const shipping_template_service_1 = require("./shipping-template.service");
const shipping_template_permissions_1 = require("./shipping-template-permissions");
let ShippingTemplateAdminResolver = class ShippingTemplateAdminResolver {
    constructor(shippingTemplateService) {
        this.shippingTemplateService = shippingTemplateService;
    }
    async shippingTemplates(ctx, options) {
        return this.shippingTemplateService.findAll(ctx, options);
    }
    async shippingTemplate(ctx, id) {
        return this.shippingTemplateService.findOne(ctx, id);
    }
    async createShippingTemplate(ctx, input) {
        return this.shippingTemplateService.create(ctx, input);
    }
    async updateShippingTemplate(ctx, input) {
        return this.shippingTemplateService.update(ctx, input);
    }
    async deleteShippingTemplate(ctx, id) {
        await this.shippingTemplateService.delete(ctx, id);
        return true;
    }
    async createShippingMethodFromTemplate(ctx, templateId, name, code) {
        return this.shippingTemplateService.createShippingMethodFromTemplate(ctx, templateId, name, code);
    }
    async updateShippingMethodShippingPrice(ctx, id, shippingPrice) {
        return this.shippingTemplateService.updateShippingMethodShippingPrice(ctx, id, shippingPrice);
    }
};
exports.ShippingTemplateAdminResolver = ShippingTemplateAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(shipping_template_permissions_1.ShippingTemplatePermissions.ReadShippingTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShippingTemplateAdminResolver.prototype, "shippingTemplates", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(shipping_template_permissions_1.ShippingTemplatePermissions.ReadShippingTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShippingTemplateAdminResolver.prototype, "shippingTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(shipping_template_permissions_1.ShippingTemplatePermissions.CreateShippingTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShippingTemplateAdminResolver.prototype, "createShippingTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(shipping_template_permissions_1.ShippingTemplatePermissions.UpdateShippingTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShippingTemplateAdminResolver.prototype, "updateShippingTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(shipping_template_permissions_1.ShippingTemplatePermissions.DeleteShippingTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], ShippingTemplateAdminResolver.prototype, "deleteShippingTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(shipping_template_permissions_1.ShippingTemplatePermissions.CreateShippingMethodFromTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('templateId')),
    __param(2, (0, graphql_1.Args)('name', { nullable: true })),
    __param(3, (0, graphql_1.Args)('code', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, String]),
    __metadata("design:returntype", Promise)
], ShippingTemplateAdminResolver.prototype, "createShippingMethodFromTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(shipping_template_permissions_1.ShippingTemplatePermissions.CreateShippingMethodFromTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('shippingPrice')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Number]),
    __metadata("design:returntype", Promise)
], ShippingTemplateAdminResolver.prototype, "updateShippingMethodShippingPrice", null);
exports.ShippingTemplateAdminResolver = ShippingTemplateAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [shipping_template_service_1.ShippingTemplateService])
], ShippingTemplateAdminResolver);
//# sourceMappingURL=shipping-template-admin.resolver.js.map