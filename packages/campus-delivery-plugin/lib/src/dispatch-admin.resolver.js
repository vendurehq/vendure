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
exports.DispatchAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const dispatch_admin_service_1 = require("./dispatch-admin.service");
const permissions_1 = require("./permissions");
let DispatchAdminResolver = class DispatchAdminResolver {
    constructor(dispatchAdmin) {
        this.dispatchAdmin = dispatchAdmin;
    }
    async campusDispatchBoard(ctx) {
        return this.dispatchAdmin.board(ctx);
    }
    async campusAssignOrder(ctx, orderId, riderCustomerId) {
        return this.dispatchAdmin.assign(ctx, orderId, riderCustomerId);
    }
    async campusBackToHall(ctx, orderId, note) {
        return this.dispatchAdmin.backToHall(ctx, orderId, note);
    }
    /** 异常处置（plan 3.4）：reassign 回大厅 / refund_diff 退差价 / coupon 发补偿券 / refund_all 全额退单 */
    async campusHandleException(ctx, orderId, action, amount, couponTemplateId, note) {
        return this.dispatchAdmin.handleException(ctx, orderId, action, amount, couponTemplateId, note);
    }
    /** A11 受控出口：强制取消（含已送达单），必须带理由并写审计 */
    async campusForceCancelOrder(ctx, orderId, reason) {
        return this.dispatchAdmin.forceCancel(ctx, orderId, reason);
    }
};
exports.DispatchAdminResolver = DispatchAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusViewDispatch),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], DispatchAdminResolver.prototype, "campusDispatchBoard", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusDispatch),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('riderCustomerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], DispatchAdminResolver.prototype, "campusAssignOrder", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusDispatch),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], DispatchAdminResolver.prototype, "campusBackToHall", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusDispatch),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('action')),
    __param(3, (0, graphql_1.Args)({ name: 'amount', type: () => graphql_1.Int, nullable: true })),
    __param(4, (0, graphql_1.Args)({ name: 'couponTemplateId', type: () => graphql_1.ID, nullable: true })),
    __param(5, (0, graphql_1.Args)({ name: 'note', type: () => String, nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, Number, Object, String]),
    __metadata("design:returntype", Promise)
], DispatchAdminResolver.prototype, "campusHandleException", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusDispatch),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('orderId')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], DispatchAdminResolver.prototype, "campusForceCancelOrder", null);
exports.DispatchAdminResolver = DispatchAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [dispatch_admin_service_1.DispatchAdminService])
], DispatchAdminResolver);
//# sourceMappingURL=dispatch-admin.resolver.js.map