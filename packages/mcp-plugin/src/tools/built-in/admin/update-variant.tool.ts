import { Injectable } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { Permission, ProductVariantService, RequestContext, StockLevelService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCustomFieldInputService } from '../custom-field-input.service';
import { idSchema, MAX_ID_LIST_LENGTH } from '../id-schema';
import { int32Schema } from '../int32-schema';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

import { variantTranslationSchema } from './translation-schemas';

const updateVariantInputSchema = z.strictObject({
    sku: shortText.describe('Stock keeping unit.').optional(),
    translations: z
        .array(variantTranslationSchema)
        .describe('Localized variant content to update.')
        .optional(),
    price: int32Schema.min(0).describe('Price as a whole number of minor units, e.g. cents.').optional(),
    optionIds: z
        .array(idSchema.describe('Vendure ID.'))
        .max(MAX_ID_LIST_LENGTH)
        .describe('Product option IDs for this variant.')
        .optional(),
    taxCategoryId: idSchema.describe('Tax category ID.').optional(),
    featuredAssetId: idSchema.describe('Featured asset ID.').optional(),
    assetIds: z
        .array(idSchema.describe('Vendure ID.'))
        .max(MAX_ID_LIST_LENGTH)
        .describe('Asset IDs to attach.')
        .optional(),
    stockOnHand: int32Schema.describe('Stock on hand.').optional(),
    trackInventory: z
        .enum(GlobalFlag)
        .describe('Inventory tracking: "TRUE", "FALSE", or "INHERIT".')
        .optional(),
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
        private stockLevelService: StockLevelService,
        private customFieldInput: McpCustomFieldInputService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateVariantToolInput) {
        await this.customFieldInput.assertWritable(ctx, 'ProductVariant', input.input.customFields);
        const [variant] = await this.productVariantService.update(ctx, [{ ...input.input, id: input.id }]);
        const { stockOnHand } = await this.stockLevelService.getAvailableStock(ctx, variant.id);
        return { variant: this.serializer.adminVariant(variant, stockOnHand) };
    }
}
