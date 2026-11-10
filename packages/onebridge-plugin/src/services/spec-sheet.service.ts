import { Injectable } from '@nestjs/common';
import { ProductService, ProductVariantService, RequestContext } from '@vendure/core';

import { resolveChannelToken } from './channel-context';

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

@Injectable()
export class OnebridgeSpecSheetService {
    constructor(
        private productService: ProductService,
        private productVariantService: ProductVariantService,
    ) {}

    async list(ctx: RequestContext, options?: SpecSheetListOptions): Promise<SpecSheetPayload[]> {
        resolveChannelToken(ctx);
        const take = Math.min(100, Math.max(1, options?.take ?? 50));
        const { items } = await this.productService.findAll(
            ctx,
            {
                take,
                filter: { enabled: { eq: true }, spec: { notEq: '' } },
                sort: { createdAt: 'ASC' },
            } as any,
            ['variants'],
        );

        const sheets: SpecSheetPayload[] = [];
        for (const product of items) {
            const customFields = (product.customFields ?? {}) as Record<string, unknown>;
            const spec = this.text(customFields.spec);
            if (!spec) continue;

            const firstVariant = product.variants?.[0];
            let price: number | null = null;
            if (firstVariant) {
                try {
                    price = await this.productVariantService.hydratePriceFields(ctx, firstVariant, 'priceWithTax');
                } catch {
                    price = null;
                }
            }

            sheets.push({
                slug: product.slug,
                krName: this.text(customFields.krName) || product.name || product.slug,
                spec,
                moq: typeof customFields.moq === 'number' ? customFields.moq : null,
                leadTime: this.text(customFields.leadTime),
                price,
            });
        }
        return sheets;
    }

    private text(value: unknown): string {
        return typeof value === 'string' ? value.trim() : '';
    }
}
