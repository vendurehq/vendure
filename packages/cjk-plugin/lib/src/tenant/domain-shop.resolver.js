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
exports.DomainShopResolver = void 0;
const core_1 = require("@vendure/core");
const graphql_1 = require("@nestjs/graphql");
const domain_resolver_service_1 = require("./domain-resolver.service");
let DomainShopResolver = class DomainShopResolver {
    constructor(domainResolverService) {
        this.domainResolverService = domainResolverService;
    }
    async resolveChannelByDomain(ctx, host) {
        return this.domainResolverService.resolveByDomain(ctx, host);
    }
    async resolveChannelByCode(ctx, code) {
        return this.domainResolverService.resolveByCode(ctx, code);
    }
    /** 全部「可用店铺」列表（已停用渠道不返回）：多租户路由判定 + 店铺切换器的公开数据源。
     *  token 仅当前渠道有值，其余为 null（避免公开批量下发全部渠道 token）。 */
    async shopChannels(ctx) {
        return this.domainResolverService.listShopChannels(ctx);
    }
};
exports.DomainShopResolver = DomainShopResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('host')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], DomainShopResolver.prototype, "resolveChannelByDomain", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('code')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], DomainShopResolver.prototype, "resolveChannelByCode", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], DomainShopResolver.prototype, "shopChannels", null);
exports.DomainShopResolver = DomainShopResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [domain_resolver_service_1.DomainResolverService])
], DomainShopResolver);
//# sourceMappingURL=domain-shop.resolver.js.map