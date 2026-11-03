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
exports.PaymentTemplateAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const payment_template_service_1 = require("./payment-template.service");
const payment_template_permissions_1 = require("./payment-template-permissions");
let PaymentTemplateAdminResolver = class PaymentTemplateAdminResolver {
    constructor(paymentTemplateService) {
        this.paymentTemplateService = paymentTemplateService;
    }
    async paymentTemplates(ctx, options) {
        return this.paymentTemplateService.findAll(ctx, options);
    }
    async paymentTemplate(ctx, id) {
        return this.paymentTemplateService.findOne(ctx, id);
    }
    async createPaymentTemplate(ctx, input) {
        return this.paymentTemplateService.create(ctx, input);
    }
    async updatePaymentTemplate(ctx, input) {
        return this.paymentTemplateService.update(ctx, input);
    }
    async deletePaymentTemplate(ctx, id) {
        await this.paymentTemplateService.delete(ctx, id);
        return true;
    }
    async createPaymentMethodFromTemplate(ctx, templateId, name, code) {
        return this.paymentTemplateService.createPaymentMethodFromTemplate(ctx, templateId, name, code);
    }
};
exports.PaymentTemplateAdminResolver = PaymentTemplateAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(payment_template_permissions_1.PaymentTemplatePermissions.ReadPaymentTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PaymentTemplateAdminResolver.prototype, "paymentTemplates", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(payment_template_permissions_1.PaymentTemplatePermissions.ReadPaymentTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PaymentTemplateAdminResolver.prototype, "paymentTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(payment_template_permissions_1.PaymentTemplatePermissions.CreatePaymentTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PaymentTemplateAdminResolver.prototype, "createPaymentTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(payment_template_permissions_1.PaymentTemplatePermissions.UpdatePaymentTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PaymentTemplateAdminResolver.prototype, "updatePaymentTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(payment_template_permissions_1.PaymentTemplatePermissions.DeletePaymentTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], PaymentTemplateAdminResolver.prototype, "deletePaymentTemplate", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Transaction)(),
    (0, core_1.Allow)(payment_template_permissions_1.PaymentTemplatePermissions.CreatePaymentMethodFromTemplate),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('templateId')),
    __param(2, (0, graphql_1.Args)('name', { nullable: true })),
    __param(3, (0, graphql_1.Args)('code', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, String]),
    __metadata("design:returntype", Promise)
], PaymentTemplateAdminResolver.prototype, "createPaymentMethodFromTemplate", null);
exports.PaymentTemplateAdminResolver = PaymentTemplateAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [payment_template_service_1.PaymentTemplateService])
], PaymentTemplateAdminResolver);
//# sourceMappingURL=payment-template-admin.resolver.js.map