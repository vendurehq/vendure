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
exports.MerchantApiController = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const settlement_service_1 = require("../settlement.service");
const merchant_api_token_service_1 = require("../merchant-api-token.service");
const IS_PROD = process.env.NODE_ENV === 'production' || process.env.IS_PROD === 'true';
/**
 * 商家对账 / 订单查询 REST API。
 *
 * 鉴权：`Authorization: Bearer <merchant-api token>`。
 * 令牌由服务端签发（见 MerchantApiTokenService），绑定 channelId 与过期时间，
 * 客户端无法伪造；不再接受公开的 Channel token（生产环境）。
 * 开发/测试环境保留 Channel token 兼容，便于本地 e2e；生产禁止。
 */
let MerchantApiController = class MerchantApiController {
    constructor(channelService, settlementService, tokenService) {
        this.channelService = channelService;
        this.settlementService = settlementService;
        this.tokenService = tokenService;
    }
    async resolveChannel(authHeader) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw new common_1.UnauthorizedException('Missing or invalid Authorization header');
        }
        const token = authHeader.slice('Bearer '.length).trim();
        if (!token) {
            throw new common_1.UnauthorizedException('Missing merchant token');
        }
        // 1. 服务端签发令牌：签名校验通过后按 token 绑定的 channelId 取渠道
        const signed = this.tokenService.verify(token);
        if (signed) {
            const defaultChannel = await this.channelService.getDefaultChannel();
            const ctx = new core_1.RequestContext({
                apiType: 'admin',
                channel: defaultChannel,
                isAuthorized: true,
                authorizedAsOwnerOnly: false,
            });
            const channel = await this.channelService.findOne(ctx, signed.channelId);
            if (!channel) {
                throw new common_1.UnauthorizedException('Merchant channel not found');
            }
            return channel;
        }
        // 2. 历史兼容：Channel token 仅在非生产接受（生产必须改用签发令牌）
        if (!IS_PROD) {
            const channel = await this.channelService.getChannelFromToken(token);
            if (channel) {
                core_1.Logger.warn('merchant-api 使用 Channel token 鉴权（仅开发环境兼容），生产请改用签发令牌', 'marketplace-plugin');
                return channel;
            }
        }
        throw new common_1.UnauthorizedException('Invalid merchant token');
    }
    buildCtx(channel) {
        return new core_1.RequestContext({
            apiType: 'admin',
            channel: channel,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }
    /** 对账单：GET /merchant-api/settlement?from=ISO&to=ISO */
    async settlement(authHeader, from, to) {
        const channel = await this.resolveChannel(authHeader);
        const fromDate = from ? new Date(from) : undefined;
        const toDate = to ? new Date(to) : undefined;
        const ctx = this.buildCtx(channel);
        const entries = await this.settlementService.exportMerchantSettlement(ctx, channel.id, fromDate, toDate);
        const total = entries.reduce((sum, e) => sum + e.totalWithTax, 0);
        return { count: entries.length, totalWithTax: total, entries };
    }
    /** 订单查询：GET /merchant-api/orders?from=ISO&to=ISO */
    async orders(authHeader, from, to) {
        const channel = await this.resolveChannel(authHeader);
        const fromDate = from ? new Date(from) : undefined;
        const toDate = to ? new Date(to) : undefined;
        const ctx = this.buildCtx(channel);
        const orders = await this.settlementService.listMerchantOrders(ctx, channel.id, fromDate, toDate);
        return {
            count: orders.length,
            items: orders.map(o => ({
                orderId: o.id,
                orderCode: o.code,
                state: o.state,
                totalWithTax: o.totalWithTax,
                currencyCode: o.currencyCode,
                orderPlacedAt: o.orderPlacedAt,
            })),
        };
    }
};
exports.MerchantApiController = MerchantApiController;
__decorate([
    (0, common_1.Get)('settlement'),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], MerchantApiController.prototype, "settlement", null);
__decorate([
    (0, common_1.Get)('orders'),
    __param(0, (0, common_1.Headers)('authorization')),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], MerchantApiController.prototype, "orders", null);
exports.MerchantApiController = MerchantApiController = __decorate([
    (0, common_1.Controller)('merchant-api'),
    __metadata("design:paramtypes", [core_1.ChannelService,
        settlement_service_1.SettlementService,
        merchant_api_token_service_1.MerchantApiTokenService])
], MerchantApiController);
