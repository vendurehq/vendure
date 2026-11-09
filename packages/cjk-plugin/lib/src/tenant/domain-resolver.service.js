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
exports.DomainResolverService = void 0;
exports.findChannelByDomain = findChannelByDomain;
exports.resolveChannelByDomain = resolveChannelByDomain;
exports.toShopChannelEntries = toShopChannelEntries;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
/** Vendure 默认渠道的 code —— 标记 isDefault，便于前端提供「返回平台店」入口 */
const DEFAULT_CHANNEL_CODE = '__default_channel__';
/**
 * 按请求 Host 解析渠道（多租户路由/回调共用）。
 *
 * 使用 emptyCtx 跨 channel 查询，避免公共请求 ctx 的潜在 channel 过滤
 * （与 group-buy-plugin / distribution-plugin 的既定模式一致）。
 * 返回完整 Channel 实体，调用方可直接用于构造 RequestContext。
 */
async function findChannelByDomain(channelService, host) {
    const normalizedHost = host.split(':')[0].toLowerCase();
    const emptyCtx = core_1.RequestContext.empty();
    const channels = await channelService.findAll(emptyCtx);
    return channels.items.find(channel => {
        var _a, _b;
        return (_b = (_a = channel.customFields) === null || _a === void 0 ? void 0 : _a.customDomains) === null || _b === void 0 ? void 0 : _b.some(d => d.toLowerCase() === normalizedHost);
    });
}
async function resolveChannelByDomain(channelService, host) {
    const channel = await findChannelByDomain(channelService, host);
    return channel ? { token: channel.token, code: channel.code } : null;
}
let DomainResolverService = class DomainResolverService {
    constructor(channelService) {
        this.channelService = channelService;
    }
    async resolveByDomain(ctx, host) {
        return resolveChannelByDomain(this.channelService, host);
    }
    /** Channel -> ChannelResolveResult 的统一映射（渠道 token 与装修 customFields） */
    toResult(channel) {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const cf = channel.customFields || {};
        return {
            token: channel.token,
            code: channel.code,
            customFields: {
                shopName: (_a = cf.shopName) !== null && _a !== void 0 ? _a : null,
                shopLogo: (_b = cf.shopLogo) !== null && _b !== void 0 ? _b : null,
                billPayStoreImage: (_c = cf.billPayStoreImage) !== null && _c !== void 0 ? _c : null,
                shopIntro: (_d = cf.shopIntro) !== null && _d !== void 0 ? _d : null,
                servicePhone: (_e = cf.servicePhone) !== null && _e !== void 0 ? _e : null,
                shopContent: (_f = cf.shopContent) !== null && _f !== void 0 ? _f : null,
                displayTemplate: (_g = cf.displayTemplate) !== null && _g !== void 0 ? _g : null,
                themeId: (_h = cf.themeId) !== null && _h !== void 0 ? _h : null,
            },
        };
    }
    async resolveByCode(ctx, code) {
        const emptyCtx = core_1.RequestContext.empty();
        const channels = await this.channelService.findAll(emptyCtx);
        for (const channel of channels.items) {
            if (channel.code === code) {
                return this.toResult(channel);
            }
        }
        return null;
    }
    /** 列出全部「可用店铺」（公开信息：code / 店铺名 / 序号 / 官方 / 是否默认渠道）。
     *
     *  这是多租户「永久可达」的数据源：前端据此判定 URL 首段的真伪、渲染店铺切换器，
     *  无需把渠道清单烘焙进构建产物，新增/启用渠道后最长一个缓存周期（前端 SWR）即生效。
     *
     *  - 排除 customFields.enabled === false 的渠道（如临时验证渠道 t24）；
     *  - 包含默认渠道并标记 isDefault，供前端提供「返回平台店」入口；
     *  - 排序：默认渠道优先，其余按 code 升序（与历史 tenant-channels.json 口径一致）；
     *  - **token 只回填「当前已解析渠道」**：调用方自己的 token 本就在请求头里，
     *    其他渠道的 token 不应再由这个公开查询批量下发。 */
    async listShopChannels(ctx) {
        const emptyCtx = core_1.RequestContext.empty();
        const channels = await this.channelService.findAll(emptyCtx);
        return toShopChannelEntries(channels.items, ctx.channelId);
    }
};
exports.DomainResolverService = DomainResolverService;
exports.DomainResolverService = DomainResolverService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.ChannelService])
], DomainResolverService);
/**
 * Channel -> 公开店铺条目的纯函数映射（便于单测）。
 *
 * token 仅当 channel.id === 当前 ctx 渠道时返回，其余为 null；
 * 这样公开查询不再具备「一次拉全站渠道 token」的能力，但当前店铺自身仍可用。
 */
function toShopChannelEntries(channels, currentChannelId) {
    return channels
        .filter(channel => { var _a; return ((_a = channel.customFields) === null || _a === void 0 ? void 0 : _a.enabled) !== false; })
        .map(channel => {
        var _a, _b;
        const cf = channel.customFields || {};
        const isDefault = channel.code === DEFAULT_CHANNEL_CODE;
        return {
            code: channel.code,
            token: String(channel.id) === String(currentChannelId) ? channel.token : null,
            name: (_a = cf.shopName) !== null && _a !== void 0 ? _a : null,
            tenantNo: (_b = cf.tenantNo) !== null && _b !== void 0 ? _b : null,
            isOfficial: isDefault || cf.isOfficial === true,
            isDefault,
        };
    })
        .sort((a, b) => {
        if (a.isDefault !== b.isDefault)
            return a.isDefault ? -1 : 1;
        return a.code.localeCompare(b.code);
    });
}
//# sourceMappingURL=domain-resolver.service.js.map