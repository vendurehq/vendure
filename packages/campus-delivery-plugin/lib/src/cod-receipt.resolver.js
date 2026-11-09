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
exports.CodReceiptAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const permissions_1 = require("./permissions");
const cod_receipt_service_1 = require("./cod-receipt.service");
/** 运营/客服：COD 收款登记、台账查询；作废需主管权限（CampusCodReceiptVoid） */
let CodReceiptAdminResolver = class CodReceiptAdminResolver {
    constructor(codCollection) {
        this.codCollection = codCollection;
    }
    async campusCodReceipts(ctx, orderId) {
        return this.codCollection.list(ctx, orderId);
    }
    async campusRegisterCodReceipt(ctx, orderId, input) {
        return this.codCollection.register(ctx, orderId, input);
    }
    async campusVoidCodReceipt(ctx, receiptId, reason) {
        return this.codCollection.voidReceipt(ctx, receiptId, reason);
    }
};
exports.CodReceiptAdminResolver = CodReceiptAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusCodReceipt),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'orderId', type: () => graphql_1.ID, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CodReceiptAdminResolver.prototype, "campusCodReceipts", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusCodReceipt),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], CodReceiptAdminResolver.prototype, "campusRegisterCodReceipt", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusCodReceiptVoid),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('receiptId')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], CodReceiptAdminResolver.prototype, "campusVoidCodReceipt", null);
exports.CodReceiptAdminResolver = CodReceiptAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [cod_receipt_service_1.CodCollectionService])
], CodReceiptAdminResolver);
//# sourceMappingURL=cod-receipt.resolver.js.map