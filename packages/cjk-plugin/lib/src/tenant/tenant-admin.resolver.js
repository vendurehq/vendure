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
exports.TenantAdminResolver = exports.TENANT_SLOT_CAPACITY = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const common_1 = require("@nestjs/common");
const tenant_member_service_1 = require("./tenant-member.service");
const tenant_member_entity_1 = require("./tenant-member.entity");
/** 租户位容量：预留前 20 个官方租户位（tenantNo 1-20，见 seedOfficialTenants） */
exports.TENANT_SLOT_CAPACITY = 20;
let TenantAdminResolver = class TenantAdminResolver {
    constructor(channelService, connection, tenantMemberService, productService) {
        this.channelService = channelService;
        this.connection = connection;
        this.tenantMemberService = tenantMemberService;
        this.productService = productService;
    }
    /** 租户位总览：capacity=20，slots 按 tenantNo 1-20 列出每格的占用情况 */
    async tenantSlots(ctx) {
        var _a;
        const { Channel } = await import('@vendure/core');
        const channels = await this.connection.getRepository(ctx, Channel).find({ take: 200000 });
        const byNo = new Map();
        for (const c of channels) {
            const no = Number((_a = c.customFields) === null || _a === void 0 ? void 0 : _a.tenantNo);
            if (Number.isFinite(no))
                byNo.set(no, c);
        }
        const capacity = exports.TENANT_SLOT_CAPACITY;
        const slots = Array.from({ length: capacity }, (_, i) => {
            var _a;
            const no = i + 1;
            const c = byNo.get(no);
            return {
                no,
                occupied: !!c,
                tenantId: c ? String(c.id) : null,
                name: c ? (((_a = c.customFields) === null || _a === void 0 ? void 0 : _a.shopName) || c.code || null) : null,
            };
        });
        return { capacity, used: slots.filter((s) => s.occupied).length, slots };
    }
    /** 清空指定租户名下全部商品（从零开始）：对该租户 channel 关联的每个商品做软删（softDelete）。不触碰配送/支付/账户等。 */
    async clearTenantProducts(ctx, channelId) {
        const { Product } = await import('@vendure/core');
        const repo = this.connection.getRepository(ctx, Product);
        const products = await repo
            .createQueryBuilder('p')
            .innerJoin('p.channels', 'ch')
            .where('ch.id = :id', { id: channelId })
            .getMany();
        let done = 0;
        for (const p of products) {
            try {
                await this.productService.softDelete(ctx, p.id);
                done++;
            }
            catch (_a) {
                // 该商品被订单等引用时跳过，逐个尽力清理
            }
        }
        return done;
    }
    async tenants(ctx, args) {
        var _a, _b, _c, _d, _e, _f;
        const filter = (_b = (_a = args.options) === null || _a === void 0 ? void 0 : _a.filter) !== null && _b !== void 0 ? _b : {};
        const qb = this.connection.getRepository(ctx, core_1.Channel).createQueryBuilder('channel');
        // 关键字：租户 code / 店铺名（列表展示字段）
        const keyword = typeof filter.keyword === 'string' ? filter.keyword.trim() : '';
        if (keyword) {
            qb.andWhere('(channel.code ILIKE :kw OR channel."customFieldsShopname" ILIKE :kw)', { kw: `%${keyword}%` });
        }
        // 状态：enabled / disabled（也兼容 boolean 与 1/0）
        const status = filter.status;
        if (status !== undefined && status !== null && status !== '') {
            const enabled = status === true ||
                String(status).toLowerCase() === 'enabled' ||
                String(status) === '1';
            qb.andWhere('channel."customFieldsEnabled" = :enabled', { enabled });
        }
        qb.skip((_d = (_c = args.options) === null || _c === void 0 ? void 0 : _c.skip) !== null && _d !== void 0 ? _d : 0).take((_f = (_e = args.options) === null || _e === void 0 ? void 0 : _e.take) !== null && _f !== void 0 ? _f : 50);
        const [items, totalItems] = await qb.getManyAndCount();
        return { items, totalItems };
    }
    async tenant(ctx, id) {
        return this.channelService.findOne(ctx, id);
    }
    async createTenant(ctx, args) {
        return this.tenantMemberService.createChannel(ctx, args.input);
    }
    async updateTenant(ctx, args) {
        await this.tenantMemberService.updateChannel(ctx, args.id, args.input);
        return this.channelService.findOne(ctx, args.id);
    }
    async setTenantEnabled(ctx, args) {
        await this.tenantMemberService.setChannelEnabled(ctx, args.id, args.enabled);
        return this.channelService.findOne(ctx, args.id);
    }
    /** 软删：标记停用，不做物理删除 */
    async deleteTenant(ctx, id) {
        await this.tenantMemberService.setChannelEnabled(ctx, id, false);
        return true;
    }
    async tenantAdministrators(ctx, channelId) {
        const repo = this.connection.getRepository(ctx, tenant_member_entity_1.TenantMember);
        const members = await repo.find({ where: { channelId }, order: { createdAt: 'ASC' } });
        return Promise.all(members.map((m) => this.tenantMemberService.memberToView(ctx, m)));
    }
    async createTenantAdministrator(ctx, args) {
        return this.tenantMemberService.createTenantAdministrator(ctx, args.channelId, args.input);
    }
    async setTenantAdministratorEnabled(ctx, args) {
        const repo = this.connection.getRepository(ctx, tenant_member_entity_1.TenantMember);
        const member = await repo.findOne({ where: { id: args.id } });
        if (!member)
            throw new Error('MEMBER_NOT_FOUND');
        await this.tenantMemberService.setMemberEnabled(ctx, member.channelId, args.id, args.enabled);
        return repo.findOne({ where: { id: args.id } });
    }
    async deleteTenantAdministrator(ctx, id) {
        const repo = this.connection.getRepository(ctx, tenant_member_entity_1.TenantMember);
        const member = await repo.findOne({ where: { id } });
        if (!member)
            throw new Error('MEMBER_NOT_FOUND');
        await this.tenantMemberService.removeMember(ctx, member.channelId, id);
        return true;
    }
    /** 重置租户管理人密码（管理员 Tab 某成员）为默认口令 you123123（仅超管） */
    async resetTenantAdministratorPassword(ctx, memberId) {
        await this.tenantMemberService.resetAdminPassword(ctx, memberId);
        return true;
    }
    async tenantRoles(ctx, channelId) {
        return this.tenantMemberService.rolesForChannel(ctx, channelId);
    }
    async createTenantRole(ctx, args) {
        return this.tenantMemberService.createTenantRole(ctx, args.channelId, args.input);
    }
    async updateTenantRole(ctx, args) {
        return this.tenantMemberService.updateTenantRole(ctx, args.roleId, args.input);
    }
    async deleteTenantRole(ctx, roleId) {
        await this.tenantMemberService.deleteTenantRole(ctx, roleId);
        return true;
    }
    async updateTenantMemberRoles(ctx, args) {
        await this.tenantMemberService.updateTenantMemberRoles(ctx, args.channelId, args.id, args.roleIds);
        return true;
    }
    async setTenantMemberRedeemProfiles(ctx, args) {
        var _a;
        return this.tenantMemberService.setMemberRedeemProfiles(ctx, ctx.channelId, args.id, (_a = args.shippingProfileIds) !== null && _a !== void 0 ? _a : []);
    }
    async tenantSearchAdmins(ctx, args) {
        return this.tenantMemberService.searchAdmins(ctx, args.channelId, args.keyword, 10);
    }
    async tenantLinkMember(ctx, args) {
        return this.tenantMemberService.linkMember(ctx, args.channelId, {
            administratorId: args.administratorId,
            roleIds: args.roleIds,
            displayName: args.displayName,
            phone: args.phone,
            remark: args.remark,
        });
    }
    async importDefaultRoles(ctx, channelId) {
        return this.tenantMemberService.importDefaultRoles(ctx, channelId);
    }
    async globalRoles(ctx) {
        return this.tenantMemberService.globalRoles(ctx);
    }
    async globalRoleTemplates(ctx) {
        return this.tenantMemberService.globalRoleTemplates(ctx);
    }
    async createGlobalRole(ctx, args) {
        return this.tenantMemberService.createGlobalRoleWithChannels(ctx, args.channelIds, args.input);
    }
    async referGlobalRoleToChannel(ctx, args) {
        await this.tenantMemberService.referGlobalRoleToChannel(ctx, args.roleId, args.channelId);
        return true;
    }
    async unreferGlobalRoleFromChannel(ctx, args) {
        await this.tenantMemberService.unreferGlobalRoleFromChannel(ctx, args.roleId, args.channelId);
        return true;
    }
};
exports.TenantAdminResolver = TenantAdminResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "tenantSlots", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "clearTenantProducts", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "tenants", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "tenant", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "createTenant", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "updateTenant", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "setTenantEnabled", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "deleteTenant", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "tenantAdministrators", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "createTenantAdministrator", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "setTenantAdministratorEnabled", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "deleteTenantAdministrator", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('memberId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "resetTenantAdministratorPassword", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "tenantRoles", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "createTenantRole", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "updateTenantRole", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('roleId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "deleteTenantRole", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "updateTenantMemberRoles", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "setTenantMemberRedeemProfiles", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "tenantSearchAdmins", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "tenantLinkMember", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "importDefaultRoles", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "globalRoles", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "globalRoleTemplates", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "createGlobalRole", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "referGlobalRoleToChannel", null);
__decorate([
    (0, graphql_1.Mutation)(),
    (0, core_1.Allow)(core_1.Permission.SuperAdmin),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, Object]),
    __metadata("design:returntype", Promise)
], TenantAdminResolver.prototype, "unreferGlobalRoleFromChannel", null);
exports.TenantAdminResolver = TenantAdminResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __param(0, (0, common_1.Inject)(core_1.ChannelService)),
    __param(1, (0, common_1.Inject)(core_1.TransactionalConnection)),
    __param(2, (0, common_1.Inject)(tenant_member_service_1.TenantMemberService)),
    __param(3, (0, common_1.Inject)(core_1.ProductService)),
    __metadata("design:paramtypes", [core_1.ChannelService,
        core_1.TransactionalConnection,
        tenant_member_service_1.TenantMemberService,
        core_1.ProductService])
], TenantAdminResolver);
//# sourceMappingURL=tenant-admin.resolver.js.map