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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantEnabledGuard = void 0;
// 租户/人员启停强授权守卫（admin 端）
// 把「停用租户(customFields.enabled)」和「停用人员(TenantMember.enabled)」从前端 UI 语义升级为 API 强授权语义：
// 每个 admin 请求实时读库校验当前 channel 与当前人员是否启用，任一关闭即拒绝，绕开前端直接调 /admin-api 同样无效。
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const resolve_tenant_member_1 = require("../tenant/resolve-tenant-member");
let TenantEnabledGuard = class TenantEnabledGuard {
    constructor(connection) {
        this.connection = connection;
    }
    async canActivate(context) {
        var _a;
        const parsed = (0, core_1.parseContext)(context);
        // 仅拦截 GraphQL admin 端请求；非 GraphQL 放行
        if (!parsed.isGraphQL)
            return true;
        const info = parsed.info;
        // 登录等无既有会话/渠道上下文的字段不拦截（ctx 未就绪由 Vendure 自行鉴权）
        if (!info)
            return true;
        const ctx = (0, core_1.internal_getRequestContext)(parsed.req);
        if (!ctx)
            return true;
        if (ctx.apiType !== 'admin')
            return true;
        const session = ctx.session;
        const user = session === null || session === void 0 ? void 0 : session.user;
        if (!user || !user.id)
            return true; // 未登录由 Vendure 鉴权兜底，此处不误伤
        const channelId = ctx.channelId;
        if (!channelId)
            return true;
        // 超管拥有全局管理权，不因某租户停用而被锁死
        if (ctx.userHasPermissions([core_1.Permission.SuperAdmin]))
            return true;
        // 实时读库校验租户是否启用
        const channelRepo = this.connection.getRepository(ctx, core_1.Channel);
        const channel = await channelRepo.findOne({ where: { id: channelId } });
        if (!channel)
            throw new core_1.ForbiddenError();
        if (((_a = channel.customFields) === null || _a === void 0 ? void 0 : _a.enabled) === false) {
            throw new core_1.ForbiddenError();
        }
        // 实时读库校验当前人员在该租户是否启用（无关联记录视为放行，如 default 渠道的普通后台账号）
        // 键错位修正（D45）：session.user.id 是 User.id，而 TenantMember.administratorId 存的是 Administrator.id。
        // 直接按 user.id 查恒空 → 匹配不到 member → 下面「停用人员」与「首登强改密」两道闸门被静默绕过（fail-open）。
        // D47：换键统一走共享 helper（tenant/resolve-tenant-member.ts），与 my-access / pick-batch 同源，杜绝再分叉。
        const member = await (0, resolve_tenant_member_1.resolveTenantMember)(ctx, this.connection, user.id, channelId);
        if (member && member.enabled === false) {
            throw new core_1.ForbiddenError();
        }
        // 首登强改密：mustChangePassword=true 时，在完成改密前仅放行基础/改密操作，其余一律拒绝
        if (member && member.mustChangePassword === true) {
            const field = parsed.info.fieldName;
            const allowedAtForcedChange = new Set([
                'tenantChangeMyPassword', // 改密本身
                'myTenantAccess', // 登录后判断是否需要跳改密
                'me',
                'logout',
                'activeChannel',
            ]);
            // 一次性重置口令超期：连改密也拒绝（口令已失效），需管理员重新重置
            const expired = member.resetPasswordExpiresAt != null &&
                new Date(member.resetPasswordExpiresAt).getTime() < Date.now();
            const allowed = expired
                ? new Set(['myTenantAccess', 'me', 'logout', 'activeChannel'])
                : allowedAtForcedChange;
            if (!field || !allowed.has(field)) {
                throw new core_1.ForbiddenError();
            }
        }
        return true;
    }
};
exports.TenantEnabledGuard = TenantEnabledGuard;
exports.TenantEnabledGuard = TenantEnabledGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], TenantEnabledGuard);
//# sourceMappingURL=tenant-enabled.guard.js.map