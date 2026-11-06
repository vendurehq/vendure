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
exports.AdminMemberResolver = exports.PosMemberInfo = void 0;
const common_1 = require("@nestjs/common");
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const constants_1 = require("../constants");
const member_price_rule_service_1 = require("../services/member-price-rule.service");
const pos_session_service_1 = require("../services/pos-session.service");
/**
 * 会员信息视图（POS 端展示用）。
 * 字段从 Customer + customFields(memberLevel/growthValue/points) 派生。
 * 注意：避免与 member-level-plugin 的 MemberInfo 类型冲突，命名为 PosMemberInfo。
 */
class PosMemberInfo {
}
exports.PosMemberInfo = PosMemberInfo;
/**
 * POS 会员识别 API + 会员价规则管理 API。
 * - findMemberByPhone / findMemberByCode：收银员通过手机号/卡号识别会员
 * - bindSessionMember / unbindSessionMember：将会员绑定到当前班次，加购时自动应用会员价
 * - 会员价规则 CRUD：管理员配置 global/category 两层规则
 */
let AdminMemberResolver = class AdminMemberResolver {
    constructor(customerService, administratorService, sessionService, ruleService, channelService) {
        this.customerService = customerService;
        this.administratorService = administratorService;
        this.sessionService = sessionService;
        this.ruleService = ruleService;
        this.channelService = channelService;
    }
    // ===== 会员识别 =====
    async findMemberByPhone(ctx, phoneNumber) {
        const customer = await this.findCustomerByPhone(ctx, phoneNumber);
        return customer ? this.buildMemberInfo(customer) : null;
    }
    async findMemberByCode(ctx, code) {
        // code 直接使用 customer.id（数字字符串）
        const idNum = parseInt(code, 10);
        if (!Number.isFinite(idNum)) {
            throw new core_1.UserInputError('卡号格式无效，应为数字');
        }
        const customer = await this.customerService.findOne(ctx, idNum);
        return customer ? this.buildMemberInfo(customer) : null;
    }
    async bindSessionMember(ctx, customerId) {
        const session = await this.requireMyOpenSession(ctx);
        const customer = await this.customerService.findOne(ctx, customerId);
        if (!customer) {
            throw new core_1.UserInputError(`会员 ${customerId} 不存在`);
        }
        session.customerId = Number(customer.id);
        session.customer = customer;
        return this.sessionService.save(session);
    }
    async unbindSessionMember(ctx) {
        const session = await this.requireMyOpenSession(ctx);
        session.customerId = null;
        session.customer = null;
        return this.sessionService.save(session);
    }
    // ===== 会员价规则 CRUD =====
    async memberPriceRules(ctx, channelId) {
        return this.ruleService.findAll(ctx, channelId ? parseInt(channelId, 10) : undefined);
    }
    async memberPriceRule(ctx, id) {
        return this.ruleService.findOne(ctx, parseInt(id, 10));
    }
    async createMemberPriceRule(ctx, input) {
        return this.ruleService.create(ctx, input);
    }
    async updateMemberPriceRule(ctx, input) {
        return this.ruleService.update(ctx, parseInt(input.id, 10), input);
    }
    async deleteMemberPriceRule(ctx, id) {
        return this.ruleService.delete(ctx, parseInt(id, 10));
    }
    // ===== Helpers =====
    async requireMyOpenSession(ctx) {
        const admin = await this.resolveOperator(ctx);
        if (!admin)
            throw new core_1.UserInputError('未登录或非管理员账号');
        const session = await this.sessionService.findMyOpenSession(Number(admin.id));
        if (!session) {
            throw new core_1.UserInputError('当前管理员无开班班次，请先开班');
        }
        return session;
    }
    async resolveOperator(ctx) {
        if (!ctx.activeUserId)
            return null;
        return this.administratorService.findOneByUserId(ctx, ctx.activeUserId);
    }
    async findCustomerByPhone(ctx, phoneNumber) {
        // 使用 CustomerService 私有方法不可行，直接走 repository 查 phoneNumber
        const list = await this.customerService.findAll(ctx, {
            filter: { phoneNumber: { eq: phoneNumber } },
            take: 1,
        });
        return list.items[0];
    }
    buildMemberInfo(customer) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const cf = (_a = customer.customFields) !== null && _a !== void 0 ? _a : {};
        return {
            customerId: customer.id,
            firstName: (_b = customer.firstName) !== null && _b !== void 0 ? _b : null,
            lastName: (_c = customer.lastName) !== null && _c !== void 0 ? _c : null,
            emailAddress: (_d = customer.emailAddress) !== null && _d !== void 0 ? _d : null,
            phoneNumber: (_e = customer.phoneNumber) !== null && _e !== void 0 ? _e : null,
            memberLevel: (_f = cf.memberLevel) !== null && _f !== void 0 ? _f : 1,
            growthValue: (_g = cf.growthValue) !== null && _g !== void 0 ? _g : 0,
            points: (_h = cf.points) !== null && _h !== void 0 ? _h : 0,
        };
    }
};
exports.AdminMemberResolver = AdminMemberResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadCustomer, constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('phoneNumber')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "findMemberByPhone", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadCustomer, constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "findMemberByCode", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('customerId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "bindSessionMember", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(constants_1.posSessionPermission.Update),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "unbindSessionMember", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadSettings, constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('channelId', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "memberPriceRules", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.ReadSettings, constants_1.posSessionPermission.Read),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "memberPriceRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.CreateSettings, constants_1.posSessionPermission.Create),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "createMemberPriceRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.UpdateSettings, constants_1.posSessionPermission.Update),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "updateMemberPriceRule", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.DeleteSettings, constants_1.posSessionPermission.Delete),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], AdminMemberResolver.prototype, "deleteMemberPriceRule", null);
exports.AdminMemberResolver = AdminMemberResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __param(0, (0, common_1.Inject)(core_1.CustomerService)),
    __param(1, (0, common_1.Inject)(core_1.AdministratorService)),
    __param(2, (0, common_1.Inject)(pos_session_service_1.PosSessionService)),
    __param(3, (0, common_1.Inject)(member_price_rule_service_1.MemberPriceRuleService)),
    __param(4, (0, common_1.Inject)(core_1.ChannelService)),
    __metadata("design:paramtypes", [core_1.CustomerService,
        core_1.AdministratorService,
        pos_session_service_1.PosSessionService,
        member_price_rule_service_1.MemberPriceRuleService,
        core_1.ChannelService])
], AdminMemberResolver);
//# sourceMappingURL=admin-member.resolver.js.map