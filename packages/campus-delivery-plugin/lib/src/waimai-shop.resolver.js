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
exports.WaimaiShopResolver = void 0;
const graphql_1 = require("@nestjs/graphql");
const core_1 = require("@vendure/core");
const search_assist_service_1 = require("./search-assist.service");
const waimai_store_service_1 = require("./waimai-store.service");
let WaimaiShopResolver = class WaimaiShopResolver {
    constructor(stores, assist) {
        this.stores = stores;
        this.assist = assist;
    }
    /** 公开只读：C 端首页店铺列表（跨渠道元数据聚合；不下发渠道 token） */
    async waimaiStoreList(ctx) {
        return this.stores.listStores(ctx);
    }
    /** 公开只读：C 端进店换取单店渠道 token（按 channelId，服务端限流） */
    async campusStoreEntry(ctx, channelId) {
        return this.stores.storeEntry(ctx, Number(channelId));
    }
    /** 公开只读：当前渠道信任文案（§113）：评价页信任签名卡三行开关 + 自定义文案 */
    async campusStoreTrust(ctx) {
        return this.stores.trustCopy(ctx);
    }
    /**
     * 公开只读：菜品每日限量/每人限购（§68）。
     * 未登录时 myToday/myRemaining 为 null；已登录返回本人当日已购与剩余。
     */
    async campusProductDailyStock(ctx) {
        return this.stores.dailyStock(ctx);
    }
    /**
     * 公开只读：语音/拍照搜索识别（P2-2）。
     * 按当前渠道配置选择服务商（mock / none），返回可直接用于站内搜索的关键词。
     */
    async campusSearchAssist(ctx, type, payload) {
        return this.assist.assist(ctx, type, payload);
    }
};
exports.WaimaiShopResolver = WaimaiShopResolver;
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], WaimaiShopResolver.prototype, "waimaiStoreList", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('channelId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String]),
    __metadata("design:returntype", Promise)
], WaimaiShopResolver.prototype, "campusStoreEntry", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], WaimaiShopResolver.prototype, "campusStoreTrust", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext]),
    __metadata("design:returntype", Promise)
], WaimaiShopResolver.prototype, "campusProductDailyStock", null);
__decorate([
    (0, graphql_1.Query)(),
    (0, core_1.Allow)(core_1.Permission.Public),
    __param(0, (0, core_1.Ctx)()),
    __param(1, (0, graphql_1.Args)('type')),
    __param(2, (0, graphql_1.Args)('payload', { nullable: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [core_1.RequestContext, String, String]),
    __metadata("design:returntype", Promise)
], WaimaiShopResolver.prototype, "campusSearchAssist", null);
exports.WaimaiShopResolver = WaimaiShopResolver = __decorate([
    (0, graphql_1.Resolver)(),
    __metadata("design:paramtypes", [waimai_store_service_1.WaimaiStoreService,
        search_assist_service_1.SearchAssistService])
], WaimaiShopResolver);
//# sourceMappingURL=waimai-shop.resolver.js.map