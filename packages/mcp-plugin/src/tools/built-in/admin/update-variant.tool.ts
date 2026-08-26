import { Injectable } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { Permission, ProductVariantService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { enumString } from '../enum-string-schema';
import { idSchema } from '../id-schema';
import { int32Schema } from '../int32-schema';
import { McpToolSerializerService } from '../serializer.service';

import { variantTranslationSchema } from './translation-schemas';

const updateVariantInputSchema = z.strictObject({
    sku: z.string().describe('Stock keeping unit.').optional(),
    translations: z
        .array(variantTranslationSchema)
        .describe('Localized variant content to update.')
        .optional(),
    price: z.number().describe('Price in minor units (e.g. cents).').optional(),
    optionIds: z
        .array(idSchema.describe('Vendure ID.'))
        .describe('Product option IDs for this variant.')
        .optional(),
    taxCategoryId: idSchema.describe('Tax category ID.').optional(),
    featuredAssetId: idSchema.describe('Featured asset ID.').optional(),
    assetIds: z.array(idSchema.describe('Vendure ID.')).describe('Asset IDs to attach.').optional(),
    stockOnHand: int32Schema.describe('Stock on hand.').optional(),
    trackInventory: enumString<GlobalFlag>(
        z.string().describe('Inventory tracking: "TRUE", "FALSE", or "INHERIT".'),
    ).optional(),
    enabled: z.boolean().describe('Whether the variant is enabled.').optional(),
    customFields: z.looseObject({}).describe('Variant custom fields.').optional(),
});

const updateVariantInput = z.strictObject({
    id: idSchema.describe('Variant ID.'),
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
    constructor(
        private productVariantService: ProductVariantService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateVariantToolInput) {
        const variants = await this.productVariantService.update(ctx, [{ ...input.input, id: input.id }]);
        return { variants: variants.map(variant => this.serializer.variant(variant)) };
    }
}
