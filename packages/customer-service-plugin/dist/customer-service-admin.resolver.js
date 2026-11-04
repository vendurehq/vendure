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
exports.CustomerServiceAdminResolver = void 0;
// e:\code\vendure\packages\customer-service-plugin\src\customer-service-admin.resolver.ts
// 采用 schema-first 模式（与 after-sales-plugin 一致）：
// - SDL 字符串定义所有 GraphQL 类型（在 customer-service.plugin.ts 中）
// - resolver 用 @Query() / @Mutation() 不指定返回类型，返回值由 GraphQL 从 schema 推断
// - 不需要 @ObjectType / @Field 装饰器
// 原因：CsOrderDetail.afterSalesRequests 引用 AfterSalesRequest 实体，但该实体没有 @ObjectType 装饰器
// （after-sales-plugin 用纯 schema-first 模式）。为保持一致性和避免修改 after-sales-plugin，本插件也用 schema-first。
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const constants_1 = require("./constants");
const customer_service_service_1 = require("./customer-service.service");
/**
 * @description
 * 客服 Admin API Resolver（schema-first 模式）。
 *
 * 权限映射：
 * - csAllOrders / csOrderDetail → ViewAllOrders
 * - csAfterSalesRequests / csAfterSalesRequestDetail / csApproveAfterSales / csRejectAfterSales / csConfirmReturnReceived / csProcessRefund → HandleAfterSales
 * - csExceptionOrders / csAddExceptionNote → HandleException
 *
 * 注意：权限名 ViewAllOrders/HandleAfterSales/HandleException 由 delivery-plugin 注册到 customPermissions，
 * 此处用 `'xxx' as Permission` 字符串字面量引用，不重复注册 PermissionDefinition。
 */
let CustomerServiceAdminResolver = class CustomerServiceAdminResolver {
    constructor(csService) {
        this.csService = csService;
    }
    // ===== 订单查询 =====
    async csAllOrders(ctx, state, customerEmail, startDate, endDate, page, pageSize) {
        if (startDate && isNaN(new Date(startDate).getTime())) {
            throw new core_1.UserInputError('startDate 必须是合法日期');
        }
        if (endDate && isNaN(new Date(endDate).getTime())) {
            throw new core_1.UserInputError('endDate 必须是合法日期');
        }
        return this.csService.findAllOrders(ctx, {
            state,
            customerEmail,
            startDate,
            endDate,
            page,
            pageSize,
        });
    }
    async csOrderDetail(ctx, id) {
        return this.csService.findOrderDetail(ctx, id);
    }
    // ===== 售后处理 =====
    // 售后 query/mutation 返回 AfterSalesRequest 实体（schema 中为 AfterSalesRequestAdmin 类型，
    // GraphQL 通过字段名匹配自动序列化实体，无需 @ObjectType 装饰器）
    async csAfterSalesRequests(ctx, state, page, pageSize) {
        return this.csService.findAfterSalesRequests(ctx, { state, page, pageSize });
    }
    async csAfterSalesRequestDetail(ctx, id) {
        return this.csService.findOneAfterSalesRequest(ctx, id);
    }
    async csApproveAfterSales(ctx, id) {
        return this.csService.approveAfterSales(ctx, id);
    }
    async csRejectAfterSales(ctx, id, reason) {
        return this.csService.rejectAfterSales(ctx, id, reason);
    }
    async csConfirmReturnReceived(ctx, id) {
        return this.csService.confirmReturnReceived(ctx, id);
    }
    async csProcessRefund(ctx, id) {
        return this.csService.processRefund(ctx, id);
    }
    // ===== 异常跟进 =====
    async csExceptionOrders(ctx, exceptionType, page, pageSize) {
        return this.csService.findExceptionOrders(ctx, { exceptionType, page, pageSize });
    }
    async csAddExceptionNote(ctx, orderId, note) {
        var _a, _b, _c;
        const order = await this.csService.addExceptionNote(ctx, orderId, note);
        const cf = ((_a = order.customFields) !== null && _a !== void 0 ? _a : {});
        return {
            order,
            exceptionInfo: {
                deliveryStatus: cf.deliveryStatus,
                exceptionType: cf.exceptionType,
                exceptionNote: cf.exceptionNote,
                exceptionPhotos: (_b = cf.exceptionPhotos) !== null && _b !== void 0 ? _b : [],
                deliveryStaffId: cf.deliveryStaffId,
            },
            csNotes: (_c = cf.csNotes) !== null && _c !== void 0 ? _c : [],
        };
    }
};
exports.CustomerServiceAdminResolver = CustomerServiceAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.ViewAllOrders),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'state', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'customerEmail', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'startDate', type: () => String, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'endDate', type: () => String, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'page', type: () => Number, nullable: true, defaultValue: 1 })),
    __param(6, (0, graphql_1.Args)({ name: 'pageSize', type: () => Number, nullable: true, defaultValue: 20 })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, String, String, Number, Number]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csAllOrders", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.ViewAllOrders),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csOrderDetail", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.HandleAfterSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'state', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'page', type: () => Number, nullable: true, defaultValue: 1 })),
    __param(3, (0, graphql_1.Args)({ name: 'pageSize', type: () => Number, nullable: true, defaultValue: 20 })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, Number, Number]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csAfterSalesRequests", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.HandleAfterSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csAfterSalesRequestDetail", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.HandleAfterSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csApproveAfterSales", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.HandleAfterSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csRejectAfterSales", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.HandleAfterSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csConfirmReturnReceived", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.HandleAfterSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csProcessRefund", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.HandleException),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'exceptionType', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'page', type: () => Number, nullable: true, defaultValue: 1 })),
    __param(3, (0, graphql_1.Args)({ name: 'pageSize', type: () => Number, nullable: true, defaultValue: 20 })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, Number, Number]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csExceptionOrders", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.CustomerServicePermissions.HandleException),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('note')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], CustomerServiceAdminResolver.prototype, "csAddExceptionNote", null);
exports.CustomerServiceAdminResolver = CustomerServiceAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [customer_service_service_1.CustomerServiceService])
], CustomerServiceAdminResolver);
