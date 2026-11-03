import { OrderListOptions } from '@vendure/common/lib/generated-types';
import { Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { MarketplaceService } from '../marketplace.service';
import { MerchantApiTokenService } from '../merchant-api-token.service';
export declare class AdminMarketplaceResolver {
    private marketplaceService;
    private connection;
    private merchantApiTokenService;
    constructor(marketplaceService: MarketplaceService, connection: TransactionalConnection, merchantApiTokenService: MerchantApiTokenService);
    /** 为指定商家渠道签发 merchant-api 令牌（仅平台超管） */
    issueMerchantApiToken(args: {
        channelId: string;
        ttlSeconds?: number;
    }): {
        token: string;
        expiresAt: string;
    };
    approveMarketplaceProduct(ctx: RequestContext, args: {
        productId: string;
    }): Promise<boolean>;
    rejectMarketplaceProduct(ctx: RequestContext, args: {
        productId: string;
        reason: string;
    }): Promise<boolean>;
    submitForMarketplaceAdmin(ctx: RequestContext, args: {
        productId: string;
    }): Promise<boolean>;
    marketplacePendingProducts(ctx: RequestContext): Promise<any>;
    approvedMarketplaceProducts(ctx: RequestContext): Promise<any>;
    platformCollections(ctx: RequestContext): Promise<{
        id: string;
        name: string;
        parentId: string | null;
    }[]>;
    setProductPlatformCategory(ctx: RequestContext, args: {
        productId: string;
        collectionId?: string;
    }): Promise<boolean>;
    marketplaceMerchantChannel(ctx: RequestContext): import("@vendure/core").Channel;
    merchantOrders(ctx: RequestContext, args: {
        saleSource?: string;
        options?: OrderListOptions;
    }): Promise<{
        items: Order[];
        totalItems: number;
    }>;
}
