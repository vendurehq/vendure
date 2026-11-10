import { ProductService, ProductVariantService, RequestContext } from '@vendure/core';
export interface SpecSheetListOptions {
    take?: number | null;
}
/** CT-09 specSheets：零 DDL，复用 Product/ProductVariant customFields + 首个变体价格。 */
export interface SpecSheetPayload {
    slug: string;
    krName: string;
    spec: string;
    moq: number | null;
    leadTime: string;
    price: number | null;
}
export declare class OnebridgeSpecSheetService {
    private productService;
    private productVariantService;
    constructor(productService: ProductService, productVariantService: ProductVariantService);
    list(ctx: RequestContext, options?: SpecSheetListOptions): Promise<SpecSheetPayload[]>;
    private text;
}
