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
exports.InvoicePdfAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const invoice_pdf_service_1 = require("./invoice-pdf.service");
let InvoicePdfAdminResolver = class InvoicePdfAdminResolver {
    constructor(invoicePdfService, orderService) {
        this.invoicePdfService = invoicePdfService;
        this.orderService = orderService;
    }
    async generateInvoicePdf(ctx, orderId) {
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order) {
            throw new Error(`Order with id ${orderId} not found`);
        }
        const assetStorageStrategy = ctx.assetStorageStrategy;
        if (!assetStorageStrategy) {
            throw new Error('AssetStorageStrategy not available');
        }
        const pdfUrl = await this.invoicePdfService.generateAndStore(ctx, order, assetStorageStrategy);
        const cf = order.customFields;
        const invoiceNumber = (cf === null || cf === void 0 ? void 0 : cf.invoiceNumber) || `INV-${orderId}-${Date.now()}`;
        await this.orderService.updateCustomFields(ctx, orderId, Object.assign(Object.assign({}, cf), { invoicePdfUrl: pdfUrl, invoiceNumber }));
        return { url: pdfUrl, invoiceNumber };
    }
};
exports.InvoicePdfAdminResolver = InvoicePdfAdminResolver;
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], InvoicePdfAdminResolver.prototype, "generateInvoicePdf", null);
exports.InvoicePdfAdminResolver = InvoicePdfAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [invoice_pdf_service_1.InvoicePdfService,
        core_1.OrderService])
], InvoicePdfAdminResolver);
