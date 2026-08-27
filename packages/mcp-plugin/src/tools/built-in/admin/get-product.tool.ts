import { Injectable } from '@nestjs/common';
import {
    ConfigService,
    idsAreEqual,
    Permission,
    ProductOptionGroupService,
    ProductService,
    ProductVariantService,
    RequestContext,
    StockLevel,
    TransactionalConnection,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { In } from 'typeorm';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const getProductInput = z.strictObject({
    id: idSchema.describe('Product ID.'),
});

type GetProductInput = z.infer<typeof getProductInput>;

// `get_product` exists in both toolsets, so this class gets its own name rather than reusing the shop
// `ShopGetProductTool`. A distinct class means stack traces and editor symbol search point at the right one.
@McpTool({
    name: 'get_product',
    toolset: 'admin',
    description:
        'Get a product by id, with its variants and option groups. Variant IDs are what ' +
        'get_stock_levels, adjust_stock and update_variant take; option IDs are what create_variant takes.',
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
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private productOptionGroupService: ProductOptionGroupService,
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetProductInput) {
        const product = await this.productService.findOne(ctx, input.id, ['featuredAsset', 'assets']);
        if (!product) {
            return { product: null };
        }

        const variants = await this.productVariantService.getVariantsByProductId(ctx, product.id, {}, []);
        const stockLevels = await this.connection.getRepository(ctx, StockLevel).find({
            where: { productVariantId: In(variants.items.map(variant => variant.id)) },
        });
        const { stockLocationStrategy } = this.configService.catalogOptions;
        const variantsWithStock = await Promise.all(
            variants.items.map(async variant => {
                const { stockOnHand } = await stockLocationStrategy.getAvailableStock(
                    ctx,
                    variant.id,
                    stockLevels.filter(level => idsAreEqual(level.productVariantId, variant.id)),
                );
                return this.serializer.adminVariant(variant, stockOnHand);
            }),
        );
        const optionGroups = await this.productOptionGroupService.getOptionGroupsByProductId(ctx, product.id);
        return {
            product: {
                ...this.serializer.product(product),
                variants: variantsWithStock,
                optionGroups: optionGroups.map(group => this.serializer.optionGroup(group)),
            },
        };
    }
}
