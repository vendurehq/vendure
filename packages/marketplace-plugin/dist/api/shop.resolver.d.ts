import { RequestContext, TransactionalConnection } from '@vendure/core';
import { MarketplaceSellerService } from '../marketplace-seller-service';
import { MarketplaceService } from '../marketplace.service';
import { CreateSellerInput } from '../types';
export declare class ShopResolver {
    private marketplaceSellerService;
    private marketplaceService;
    private connection;
    constructor(marketplaceSellerService: MarketplaceSellerService, marketplaceService: MarketplaceService, connection: TransactionalConnection);
    /** Product.name/slug 为非实体列，需从 translations 取（优先当前语言，回退首个） */
    private translate;
    registerMarketplaceSeller(ctx: RequestContext, args: {
        input: {
            shopName: string;
            seller: CreateSellerInput;
        };
    }): Promise<{
        __typename: string;
        id: import("@vendure/core").ID;
        code: string;
        token: string;
        errorCode?: undefined;
        message?: undefined;
    } | {
        __typename: string;
        errorCode: string;
        message: string;
        id?: undefined;
        code?: undefined;
        token?: undefined;
    }>;
    /** 聚合列表项映射：product → GraphQL MarketplaceProduct */
    private toMarketplaceProduct;
    /** take 限定 1..100，skip 不得为负；未传时保持原行为（不限制） */
    private normalizePaging;
    marketplaceProducts(ctx: RequestContext, args: {
        take?: number;
        skip?: number;
    }): Promise<{
        id: import("@vendure/core").ID;
        name: string;
        slug: string;
        barcode: string | null;
        internalCode: string | null;
        merchantChannel: {
            id: any;
            code: any;
            name: any;
        } | null;
    }[]>;
    /** 分页版本：返回切片 + totalItems（不改变 marketplaceProducts 的返回类型） */
    marketplaceProductPage(ctx: RequestContext, args: {
        take?: number;
        skip?: number;
    }): Promise<{
        items: {
            id: import("@vendure/core").ID;
            name: string;
            slug: string;
            barcode: string | null;
            internalCode: string | null;
            merchantChannel: {
                id: any;
                code: any;
                name: any;
            } | null;
        }[];
        totalItems: number;
    }>;
    submitForMarketplace(ctx: RequestContext, args: {
        productId: string;
    }): Promise<boolean>;
    myMerchantProducts(ctx: RequestContext): Promise<{
        id: import("@vendure/core").ID;
        name: string;
        slug: string;
        barcode: string | null;
        internalCode: string | null;
        marketplaceStatus: string;
        rejectReason: string | null;
        listedInMarketplace: boolean;
    }[]>;
    marketplacePendingProducts(ctx: RequestContext): Promise<{
        id: import("@vendure/core").ID;
        name: string;
        slug: string;
        barcode: string | null;
        internalCode: string | null;
        marketplaceStatus: string;
        rejectReason: string | null;
        listedInMarketplace: boolean;
    }[]>;
    marketplaceApprove(ctx: RequestContext, args: {
        productId: string;
    }): Promise<boolean>;
    marketplaceReject(ctx: RequestContext, args: {
        productId: string;
        reason: string;
    }): Promise<boolean>;
}
