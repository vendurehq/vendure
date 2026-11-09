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
exports.RiderAdminResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const rider_service_1 = require("./rider.service");
const permissions_1 = require("./permissions");
const rider_wallet_service_1 = require("./rider-wallet.service");
let RiderAdminResolver = class RiderAdminResolver {
    constructor(riderService, wallet) {
        this.riderService = riderService;
        this.wallet = wallet;
    }
    /** 骑手入驻申请列表（F8 分页：返回 { items, total }） */
    async riderApplications(ctx, status, skip, take) {
        return this.riderService.listApplications(ctx, status, skip, take);
    }
    async campusSetRiderStatus(ctx, customerId, status) {
        return this.riderService.setRiderStatus(ctx, Number(customerId), status);
    }
    /** 绑定/解绑骑手飞书身份：openId 为空即解绑；可反复重绑（不是一次性绑定）。
     * open_id 是飞书应用维度标识，必须与 appId 成对绑定；appId 缺省取骑手应用环境变量。
     * 抢单回调按「appId + open_id」反查 Customer，绑定错人时运营先解绑再绑正确账号。 */
    async campusSetRiderFeishuBinding(ctx, customerId, openId, appId) {
        return this.riderService.setFeishuBinding(ctx, Number(customerId), openId, appId);
    }
    /** P2-5 骑手合规：登记/更新健康证、保险、背调，返回最新合规判定 */
    async campusUpdateRiderCompliance(ctx, customerId, input) {
        return this.riderService.updateCompliance(ctx, Number(customerId), input);
    }
    /** 骑手提现申请列表（status=ALL/PENDING/PAID/REJECTED）。
     * 钱包为平台级（余额跨渠道汇总），列表按设计不限定店铺渠道；审核权限 CampusAuditRider。 */
    async riderWithdrawals(ctx, status, skip, take) {
        return this.wallet.adminList(ctx, status, skip, take);
    }
    /** 通过：标记 PAID + 登记打款流水号/凭证（金额已在申请时冻结扣减） */
    async approveRiderWithdraw(ctx, id, remark, payoutRef, payoutProof) {
        return this.wallet.adminApprove(ctx, id, remark, payoutRef, payoutProof);
    }
    /** 驳回：状态 REJECTED 并退回冻结金额 */
    async rejectRiderWithdraw(ctx, id, remark) {
        return this.wallet.adminReject(ctx, id, remark);
    }
    /** 打款失败回退：PAID → FAILED，退回冻结金额（转账被退回/账号错误时使用） */
    async campusMarkWithdrawFailed(ctx, id, reason) {
        return this.wallet.adminMarkFailed(ctx, id, reason);
    }
};
exports.RiderAdminResolver = RiderAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusAuditRider),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('status')),
    __param(2, (0, graphql_1.Args)('skip', { nullable: true })),
    __param(3, (0, graphql_1.Args)('take', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, Number, Number]),
    __metadata("design:returntype", Promise)
], RiderAdminResolver.prototype, "riderApplications", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusAuditRider),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('customerId')),
    __param(2, (0, graphql_1.Args)('status')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], RiderAdminResolver.prototype, "campusSetRiderStatus", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusAuditRider),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('customerId')),
    __param(2, (0, graphql_1.Args)('openId', { nullable: true })),
    __param(3, (0, graphql_1.Args)('appId', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, String]),
    __metadata("design:returntype", Promise)
], RiderAdminResolver.prototype, "campusSetRiderFeishuBinding", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusAuditRider),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('customerId')),
    __param(2, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, Object]),
    __metadata("design:returntype", Promise)
], RiderAdminResolver.prototype, "campusUpdateRiderCompliance", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusAuditRider),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('status', { nullable: true })),
    __param(2, (0, graphql_1.Args)('skip', { nullable: true })),
    __param(3, (0, graphql_1.Args)('take', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, Number, Number]),
    __metadata("design:returntype", Promise)
], RiderAdminResolver.prototype, "riderWithdrawals", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusAuditRider),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('remark', { nullable: true })),
    __param(3, (0, graphql_1.Args)('payoutRef', { nullable: true })),
    __param(4, (0, graphql_1.Args)('payoutProof', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String, String, String]),
    __metadata("design:returntype", Promise)
], RiderAdminResolver.prototype, "approveRiderWithdraw", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusAuditRider),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('remark', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], RiderAdminResolver.prototype, "rejectRiderWithdraw", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(permissions_1.CampusPermissions.CampusAuditRider),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __param(2, (0, graphql_1.Args)('reason')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object, String]),
    __metadata("design:returntype", Promise)
], RiderAdminResolver.prototype, "campusMarkWithdrawFailed", null);
exports.RiderAdminResolver = RiderAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [rider_service_1.RiderService,
        rider_wallet_service_1.RiderWalletService])
], RiderAdminResolver);
//# sourceMappingURL=rider-admin.resolver.js.map