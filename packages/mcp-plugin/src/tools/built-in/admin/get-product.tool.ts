import { Injectable } from '@nestjs/common';
import {
    Permission,
    ProductOptionGroupService,
    ProductService,
    ProductVariantService,
    RequestContext,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCatalogQueryService } from '../catalog-query.service';
import { idSchema } from '../id-schema';
import { variantOffset, variantPaging } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const getProductInput = z.strictObject({
    id: idSchema.describe('Product ID.'),
    variantOffset,
});

type GetProductInput = z.infer<typeof getProductInput>;

// Named distinctly from the shop version so stack traces and symbol search aren't ambiguous.
@McpTool({
    name: 'get_product',
    toolset: 'admin',
    description:
        'Get a product by id, with its variants and option groups. Variant IDs are what ' +
        'get_stock_levels, adjust_stock and update_variant take; option IDs are what create_variant ' +
        'takes. When hasMoreVariants is true, call again with variantOffset to get the next batch.',
    keywords: [
        'look up a product record',
        'view a product in the back office',
        'inspect a single product by id',
        'pull up product details as staff',
        'open a catalog item for editing',
        'fetch admin product info',
    ],
    permissions: [Permission.ReadProduct],
    behavior: 'readonly',
    inputSchema: getProductInput,
})
@Injectable()
export class AdminGetProductTool implements McpToolHandler<GetProductInput> {
    constructor(
        private readonly productService: ProductService,
        private readonly productVariantService: ProductVariantService,
        private readonly productOptionGroupService: ProductOptionGroupService,
        private readonly catalog: McpCatalogQueryService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetProductInput) {
        const product = await this.productService.findOne(ctx, input.id, ['featuredAsset', 'assets']);
        if (!product) {
            return { product: null };
        }

        const offset = input.variantOffset ?? 0;
        const variants = await this.productVariantService.getVariantsByProductId(
            ctx,
            product.id,
            { skip: offset },
            [],
        );
        const withStock = await this.catalog.withAvailableStock(ctx, variants.items);
        const variantsWithStock = withStock.map(({ variant, stockOnHand }) =>
            this.serializer.adminVariant(variant, stockOnHand),
        );
        const optionGroups = await this.productOptionGroupService.getOptionGroupsByProductId(ctx, product.id);
        return {
            product: {
                ...this.serializer.product(product),
                variants: variantsWithStock,
                ...variantPaging(offset, variants),
                optionGroups: optionGroups.map(group => this.serializer.optionGroup(group)),
            },
        };
    }
}
