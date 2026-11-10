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
exports.OnebridgeAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const permissions_1 = require("../permissions");
const services_1 = require("../services");
const RfqManage = permissions_1.OnebridgePermissions.RfqManage;
const ContentManage = permissions_1.OnebridgePermissions.ContentManage;
const InspectionManage = permissions_1.OnebridgePermissions.InspectionManage;
const CustomsManage = permissions_1.OnebridgePermissions.CustomsManage;
let OnebridgeAdminResolver = class OnebridgeAdminResolver {
    constructor(rfqService, contentService, inspectionService, customsService, orderSummaryService, specSheetService) {
        this.rfqService = rfqService;
        this.contentService = contentService;
        this.inspectionService = inspectionService;
        this.customsService = customsService;
        this.orderSummaryService = orderSummaryService;
        this.specSheetService = specSheetService;
    }
    // ===== RFQ =====
    onebridgeRfqs(ctx, options) {
        return this.rfqService.adminList(ctx, options);
    }
    onebridgeRfq(ctx, args) {
        return this.rfqService.adminFind(ctx, args.id, args.code);
    }
    saveRfqQuote(ctx, rfqId, input) {
        return this.rfqService.saveQuote(ctx, rfqId, input);
    }
    saveRfqSample(ctx, rfqId, input) {
        return this.rfqService.saveSample(ctx, rfqId, input);
    }
    transitionRfqStage(ctx, args) {
        return this.rfqService.transitionStage(ctx, args.rfqId, args.stage, {
            title: args.title,
            desc: args.desc,
            idempotencyKey: args.idempotencyKey,
        });
    }
    // ===== 内容 =====
    onebridgeContentEntries(ctx, options) {
        return this.contentService.adminList(ctx, options);
    }
    saveOnebridgeContentEntry(ctx, input) {
        return this.contentService.save(ctx, input);
    }
    deleteOnebridgeContentEntry(ctx, id) {
        return this.contentService.delete(ctx, id);
    }
    // ===== 验货 =====
    onebridgeInspectionReports(ctx, options) {
        return this.inspectionService.adminList(ctx, options);
    }
    createOnebridgeInspectionReport(ctx, input) {
        return this.inspectionService.create(ctx, input);
    }
    publishOnebridgeInspectionReport(ctx, id) {
        return this.inspectionService.publish(ctx, id);
    }
    // ===== 清关 =====
    onebridgeCustomsRecord(ctx, orderCode) {
        return this.customsService.findByOrderCode(ctx, orderCode);
    }
    onebridgeCustomsRecords(ctx, options) {
        return this.customsService.adminList(ctx, options);
    }
    upsertOnebridgeCustomsRecord(ctx, input) {
        return this.customsService.upsert(ctx, input);
    }
    // ===== 订单聚合 =====
    onebridgeOrderSummary(ctx, orderCode) {
        return this.orderSummaryService.summary(ctx, orderCode, false);
    }
    // ===== 规格表（只读投影，数据源为 Product customFields）=====
    onebridgeSpecSheets(ctx, take) {
        return this.specSheetService.list(ctx, { take });
    }
};
exports.OnebridgeAdminResolver = OnebridgeAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(RfqManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "onebridgeRfqs", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(RfqManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "onebridgeRfq", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(RfqManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('rfqId')),
    __param(2, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "saveRfqQuote", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(RfqManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('rfqId')),
    __param(2, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "saveRfqSample", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(RfqManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "transitionRfqStage", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(ContentManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "onebridgeContentEntries", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(ContentManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "saveOnebridgeContentEntry", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(ContentManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "deleteOnebridgeContentEntry", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(InspectionManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "onebridgeInspectionReports", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(InspectionManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "createOnebridgeInspectionReport", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(InspectionManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "publishOnebridgeInspectionReport", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(CustomsManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "onebridgeCustomsRecord", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(CustomsManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('options')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "onebridgeCustomsRecords", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(CustomsManage),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "upsertOnebridgeCustomsRecord", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "onebridgeOrderSummary", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadProduct),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('take')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Number]),
    __metadata("design:returntype", void 0)
], OnebridgeAdminResolver.prototype, "onebridgeSpecSheets", null);
exports.OnebridgeAdminResolver = OnebridgeAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [services_1.OnebridgeRfqService,
        services_1.OnebridgeContentService,
        services_1.OnebridgeInspectionService,
        services_1.OnebridgeCustomsService,
        services_1.OnebridgeOrderSummaryService,
        services_1.OnebridgeSpecSheetService])
], OnebridgeAdminResolver);
//# sourceMappingURL=admin.resolver.js.map