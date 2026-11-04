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
exports.SalesAdminResolver = void 0;
// e:\code\vendure\packages\sales-plugin\src\sales-admin.resolver.ts
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const shared_constants_1 = require("@vendure/common/lib/shared-constants");
const constants_1 = require("./constants");
const sales_service_1 = require("./sales.service");
let SalesAdminResolver = class SalesAdminResolver {
    constructor(salesService, administratorService) {
        this.salesService = salesService;
        this.administratorService = administratorService;
    }
    /**
     * 校验报表日期范围，避免把 Invalid Date 传进 SQL
     */
    parseRange(start, end) {
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
            throw new core_1.UserInputError('start/end 必须是合法日期');
        }
        return { start: startDate, end: endDate };
    }
    /**
     * 销售员判断是否为 manager+（可查全部）
     */
    async isManager(ctx) {
        var _a, _b, _c, _d, _e;
        if (!ctx.activeUserId)
            return false;
        const admin = await this.administratorService.findOneByUserId(ctx, ctx.activeUserId, [
            'user',
            'user.roles',
        ]);
        const roles = (_c = (_b = (_a = admin === null || admin === void 0 ? void 0 : admin.user) === null || _a === void 0 ? void 0 : _a.roles) === null || _b === void 0 ? void 0 : _b.map(r => r.code)) !== null && _c !== void 0 ? _c : [];
        return (roles.includes('manager') ||
            roles.includes('super-admin') ||
            roles.includes(shared_constants_1.SUPER_ADMIN_ROLE_CODE) ||
            ((_e = (_d = admin === null || admin === void 0 ? void 0 : admin.user) === null || _d === void 0 ? void 0 : _d.roles) !== null && _e !== void 0 ? _e : []).some(r => { var _a; return (_a = r.permissions) === null || _a === void 0 ? void 0 : _a.includes(core_1.Permission.SuperAdmin); }));
    }
    async mySales(ctx, state, page, pageSize) {
        const result = await this.salesService.findMySales(ctx, { state, page, pageSize });
        return result.items;
    }
    async allSales(ctx, state, staffId, page, pageSize) {
        const result = await this.salesService.findAllSales(ctx, { state, staffId, page, pageSize });
        return result.items;
    }
    async salesOrder(ctx, id) {
        var _a;
        const result = await this.salesService.findMySales(ctx);
        return (_a = result.items.find(o => String(o.id) === String(id))) !== null && _a !== void 0 ? _a : null;
    }
    async salesCreateOrder(ctx, input) {
        return this.salesService.createOrder(ctx, input);
    }
    async modifyOrderLinePrice(ctx, orderLineId, newPrice) {
        return this.salesService.modifyOrderLinePrice(ctx, orderLineId, newPrice);
    }
    async cancelSalesOrder(ctx, orderId, reason) {
        return this.salesService.cancelOrder(ctx, orderId, reason);
    }
    async mySalesReport(ctx, start, end) {
        const range = this.parseRange(start, end);
        if (!ctx.activeUserId)
            return this.salesService.buildReport(ctx, undefined, range);
        return this.salesService.buildReport(ctx, String(ctx.activeUserId), range);
    }
    async salesReport(ctx, start, end, staffId) {
        const range = this.parseRange(start, end);
        const isManager = await this.isManager(ctx);
        const targetStaffId = isManager ? staffId : String(ctx.activeUserId);
        if (!isManager && staffId && staffId !== String(ctx.activeUserId)) {
            throw new core_1.ForbiddenError();
        }
        return this.salesService.buildReport(ctx, targetStaffId, range);
    }
};
exports.SalesAdminResolver = SalesAdminResolver;
__decorate([
    (0, graphql_1.Query)(() => [core_1.Order]),
    (0, core_1.Allow)(constants_1.SalesPermissions.ViewOwnSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'state', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'page', type: () => Number, nullable: true, defaultValue: 1 })),
    __param(3, (0, graphql_1.Args)({ name: 'pageSize', type: () => Number, nullable: true, defaultValue: 20 })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, Number, Number]),
    __metadata("design:returntype", Promise)
], SalesAdminResolver.prototype, "mySales", null);
__decorate([
    (0, graphql_1.Query)(() => [core_1.Order]),
    (0, core_1.Allow)(constants_1.SalesPermissions.ViewAllSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'state', type: () => String, nullable: true })),
    __param(2, (0, graphql_1.Args)({ name: 'staffId', type: () => String, nullable: true })),
    __param(3, (0, graphql_1.Args)({ name: 'page', type: () => Number, nullable: true, defaultValue: 1 })),
    __param(4, (0, graphql_1.Args)({ name: 'pageSize', type: () => Number, nullable: true, defaultValue: 20 })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, Number, Number]),
    __metadata("design:returntype", Promise)
], SalesAdminResolver.prototype, "allSales", null);
__decorate([
    (0, graphql_1.Query)(() => core_1.Order, { nullable: true }),
    (0, core_1.Allow)(constants_1.SalesPermissions.ViewOwnSales),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], SalesAdminResolver.prototype, "salesOrder", null);
__decorate([
    (0, graphql_1.Mutation)(() => core_1.Order),
    (0, core_1.Allow)(constants_1.SalesPermissions.CreateOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'input', type: () => sales_service_1.SalesCreateOrderInput })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext,
        sales_service_1.SalesCreateOrderInput]),
    __metadata("design:returntype", Promise)
], SalesAdminResolver.prototype, "salesCreateOrder", null);
__decorate([
    (0, graphql_1.Mutation)(() => core_1.Order),
    (0, core_1.Allow)(constants_1.SalesPermissions.ModifyOrderPrice),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderLineId')),
    __param(2, (0, graphql_1.Args)({ name: 'newPrice', type: () => Number })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Number]),
    __metadata("design:returntype", Promise)
], SalesAdminResolver.prototype, "modifyOrderLinePrice", null);
__decorate([
    (0, graphql_1.Mutation)(() => core_1.Order),
    (0, core_1.Allow)(constants_1.SalesPermissions.CreateOrder),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)({ name: 'reason', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], SalesAdminResolver.prototype, "cancelSalesOrder", null);
__decorate([
    (0, graphql_1.Query)(() => sales_service_1.SalesReportResult),
    (0, core_1.Allow)(constants_1.SalesPermissions.ViewSalesReport),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'start', type: () => String })),
    __param(2, (0, graphql_1.Args)({ name: 'end', type: () => String })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String]),
    __metadata("design:returntype", Promise)
], SalesAdminResolver.prototype, "mySalesReport", null);
__decorate([
    (0, graphql_1.Query)(() => sales_service_1.SalesReportResult),
    (0, core_1.Allow)(constants_1.SalesPermissions.ViewSalesReport),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)({ name: 'start', type: () => String })),
    __param(2, (0, graphql_1.Args)({ name: 'end', type: () => String })),
    __param(3, (0, graphql_1.Args)({ name: 'staffId', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String, String]),
    __metadata("design:returntype", Promise)
], SalesAdminResolver.prototype, "salesReport", null);
exports.SalesAdminResolver = SalesAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [sales_service_1.SalesService,
        core_1.AdministratorService])
], SalesAdminResolver);
