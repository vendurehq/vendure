import { Injectable } from '@nestjs/common';
import { GlobalFlag, LanguageCode } from '@vendure/common/lib/generated-types';
import { Permission, ProductVariantService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { variantSummary } from '../serializers';

const variantTranslationSchema = z.strictObject({
    // Cast is type-only (no runtime effect, schema still emits `type: "string"`): the generated
    // service call expects the real LanguageCode enum, but the JSON schema for this field is a
    // plain string, so z.infer alone would type it as `string`.
    languageCode: z.string().describe('Language code, e.g. "en".') as unknown as z.ZodType<LanguageCode>,
    name: z.string().describe('Variant name.').optional(),
});

const updateVariantInputSchema = z.strictObject({
    sku: z.string().describe('Stock keeping unit.').optional(),
    translations: z
        .array(variantTranslationSchema)
        .describe('Localized variant content to update.')
        .optional(),
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
    stockOnHand: z.number().describe('Stock on hand.').optional(),
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

const updateVariantInput = z.strictObject({
    id: z.union([z.string(), z.number()]).describe('Variant ID.'),
    input: updateVariantInputSchema,
});

type UpdateVariantToolInput = z.infer<typeof updateVariantInput>;

@McpTool({
    name: 'update_variant',
    toolset: 'admin',
    description: "Update an existing product variant's details, such as its price, SKU or stock on hand.",
    keywords: [
        'edit a variant',
        'change a price or sku',
        'update a size or color option',
        'modify variant details',
        'fix a specific variation',
        'edit product option info',
    ],
    permissions: [Permission.UpdateProduct],
    behavior: 'mutating',
    inputSchema: updateVariantInput,
})
@Injectable()
export class UpdateVariantTool implements McpToolHandler<UpdateVariantToolInput> {
    constructor(private productVariantService: ProductVariantService) {}

    async execute(ctx: RequestContext, input: UpdateVariantToolInput) {
        const variants = await this.productVariantService.update(ctx, [{ ...input.input, id: input.id }]);
        return { variants: variants.map(variant => variantSummary(variant)) };
    }
}
