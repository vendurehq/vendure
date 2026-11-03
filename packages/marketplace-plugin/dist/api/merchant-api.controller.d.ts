import { ChannelService } from '@vendure/core';
import { SettlementService } from '../settlement.service';
import { MerchantApiTokenService } from '../merchant-api-token.service';
/**
 * 商家对账 / 订单查询 REST API。
 *
 * 鉴权：`Authorization: Bearer <merchant-api token>`。
 * 令牌由服务端签发（见 MerchantApiTokenService），绑定 channelId 与过期时间，
 * 客户端无法伪造；不再接受公开的 Channel token（生产环境）。
 * 开发/测试环境保留 Channel token 兼容，便于本地 e2e；生产禁止。
 */
export declare class MerchantApiController {
    private channelService;
    private settlementService;
    private tokenService;
    constructor(channelService: ChannelService, settlementService: SettlementService, tokenService: MerchantApiTokenService);
    private resolveChannel;
    private buildCtx;
    /** 对账单：GET /merchant-api/settlement?from=ISO&to=ISO */
    settlement(authHeader: string, from?: string, to?: string): Promise<{
        count: number;
        totalWithTax: number;
        entries: import("../settlement.service").MerchantSettlementEntry[];
    }>;
    /** 订单查询：GET /merchant-api/orders?from=ISO&to=ISO */
    orders(authHeader: string, from?: string, to?: string): Promise<{
        count: number;
        items: {
            orderId: import("@vendure/core").ID;
            orderCode: string;
            state: import("@vendure/core").OrderState;
            totalWithTax: number;
            currencyCode: import("@vendure/core").CurrencyCode;
            orderPlacedAt: Date | undefined;
        }[];
    }>;
}
