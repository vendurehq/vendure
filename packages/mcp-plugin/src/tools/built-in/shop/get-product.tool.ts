import { Injectable } from '@nestjs/common';
import { Permission, ProductService, ProductVariantService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { variantOffset, variantPaging } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

const getProductInput = z.strictObject({
    id: idSchema.describe('Product ID.').optional(),
    slug: shortText.describe('Product slug, used when ID is omitted.').optional(),
    variantOffset,
});

type GetProductInput = z.infer<typeof getProductInput>;

@McpTool({
    name: 'get_product',
    toolset: 'shop',
    description:
        'Get an enabled product by ID or slug, including its purchasable variants. Each variant ' +
        'carries the ID that add_to_cart needs. When hasMoreVariants is true, call again with ' +
        'variantOffset to get the next batch.',
    keywords: [
        'tell me about this item',
        'show me this product',
        'product details for shoppers',
        'view an item page',
        'info on a specific product',
        'see this thing you sell',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: getProductInput,
})
@Injectable()
export class ShopGetProductTool implements McpToolHandler<GetProductInput> {
    constructor(
        private readonly productService: ProductService,
        private readonly productVariantService: ProductVariantService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetProductInput) {
        const product = await this.findProduct(ctx, input);
        if (product?.enabled !== true) {
            return { product: null };
        }
        // Prices are not stored on the variant row; Vendure works them out per sales channel at
        // request time, and only ProductVariantService does that. Loading the `variants` relation
        // through ProductService above would return variants with no price and no error. The empty
        // relations list skips the assets, facets and options this summary never uses. Because this
        // is a shop tool, the service already limits the result to enabled variants in this channel.
        const offset = input.variantOffset ?? 0;
        const variants = await this.productVariantService.getVariantsByProductId(
            ctx,
            product.id,
            { skip: offset },
            [],
        );
        return {
            product: {
                ...this.serializer.product(product),
                variants: variants.items.map(variant => this.serializer.variant(variant)),
                ...variantPaging(offset, variants),
            },
        };
    }

    private async findProduct(ctx: RequestContext, input: GetProductInput) {
        if (input.id != null) {
            return this.productService.findOne(ctx, input.id, ['featuredAsset', 'assets']);
        }
        if (input.slug != null) {
            return this.productService.findOneBySlug(ctx, input.slug, ['featuredAsset', 'assets']);
        }
        return undefined;
    }
}
