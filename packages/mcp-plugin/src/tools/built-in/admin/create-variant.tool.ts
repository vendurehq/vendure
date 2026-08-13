import { Injectable } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { Permission, ProductVariantService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { variantTranslationSchema } from './translation-schemas';

const createVariantInputSchema = z.strictObject({
    sku: z.string().describe('Stock keeping unit.'),
    translations: z.array(variantTranslationSchema).describe('Localized variant content.'),
    price: z.number().describe('Price in minor units (e.g. cents).').optional(),
    optionIds: z
        .array(z.union([z.string(), z.number()]).describe('Vendure ID.'))
        .describe('Product option IDs for this variant.')
        .optional(),
    taxCategoryId: z.union([z.string(), z.number()]).describe('Tax category ID.').optional(),
    featuredAssetId: z.union([z.string(), z.number()]).describe('Featured asset ID.').optional(),
    assetIds: z
        .array(z.union([z.string(), z.number()]).describe('Vendure ID.'))
        .describe('Asset IDs to attach.')
        .optional(),
    stockOnHand: z.number().describe('Initial stock on hand.').optional(),
    // Cast is type-only (no runtime effect, schema still emits `type: "string"`): the generated
    // service call expects the real GlobalFlag enum, but the JSON schema for this field is a
    // plain string, so z.infer alone would type it as `string`.
    trackInventory: z
        .string()
        .describe('Inventory tracking: "TRUE", "FALSE", or "INHERIT".')
        .optional() as unknown as z.ZodOptional<z.ZodType<GlobalFlag>>,
    enabled: z.boolean().describe('Whether the variant is enabled.').optional(),
    customFields: z.looseObject({}).describe('Variant custom fields.').optional(),
});

const createVariantInput = z.strictObject({
    productId: z.union([z.string(), z.number()]).describe('Parent product ID.'),
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
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateVariantToolInput) {
        const variants = await this.productVariantService.create(ctx, [
            { ...input.input, productId: input.productId },
        ]);
        return { variants: variants.map(variant => this.serializer.variant(variant)) };
    }
}
