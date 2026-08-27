import { Injectable } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { Permission, ProductVariantService, RequestContext, StockLevelService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { enumString } from '../enum-string-schema';
import { idSchema } from '../id-schema';
import { int32Schema } from '../int32-schema';
import { McpToolSerializerService } from '../serializer.service';

import { variantTranslationSchema } from './translation-schemas';

const createVariantInputSchema = z.strictObject({
    sku: z.string().describe('Stock keeping unit.'),
    translations: z.array(variantTranslationSchema).describe('Localized variant content.'),
    price: z.number().describe('Price in minor units (e.g. cents).').optional(),
    optionIds: z
        .array(idSchema.describe('Vendure ID.'))
        .describe('Product option IDs for this variant.')
        .optional(),
    taxCategoryId: idSchema.describe('Tax category ID.').optional(),
    featuredAssetId: idSchema.describe('Featured asset ID.').optional(),
    assetIds: z.array(idSchema.describe('Vendure ID.')).describe('Asset IDs to attach.').optional(),
    stockOnHand: int32Schema.describe('Initial stock on hand.').optional(),
    trackInventory: enumString<GlobalFlag>(
        z.string().describe('Inventory tracking: "TRUE", "FALSE", or "INHERIT".'),
    ).optional(),
    enabled: z.boolean().describe('Whether the variant is enabled.').optional(),
    customFields: z.looseObject({}).describe('Variant custom fields.').optional(),
});

const createVariantInput = z.strictObject({
    productId: idSchema.describe('Parent product ID.'),
    input: createVariantInputSchema,
});

type CreateVariantToolInput = z.infer<typeof createVariantInput>;

@McpTool({
    name: 'create_variant',
    toolset: 'admin',
    description:
        'Create a new variant of an existing product (e.g. a size or color option), with its SKU, price and stock.',
    keywords: [
        'add a size or color option',
        'create a new sku',
        'add a variant to a product',
        'make another version of an item',
        'new product option',
        'add a variation',
    ],
    permissions: [Permission.UpdateProduct],
    behavior: 'mutating',
    inputSchema: createVariantInput,
})
@Injectable()
export class CreateVariantTool implements McpToolHandler<CreateVariantToolInput> {
    constructor(
        private productVariantService: ProductVariantService,
        private stockLevelService: StockLevelService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateVariantToolInput) {
        const [variant] = await this.productVariantService.create(ctx, [
            { ...input.input, productId: input.productId },
        ]);
        const { stockOnHand } = await this.stockLevelService.getAvailableStock(ctx, variant.id);
        return { variant: this.serializer.adminVariant(variant, stockOnHand) };
    }
}
