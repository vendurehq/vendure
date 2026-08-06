import { Injectable } from '@nestjs/common';
import { UpdateProductVariantInput } from '@vendure/common/lib/generated-types';
import { ID, Permission, ProductVariantService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import {
    arrayProp,
    booleanProp,
    idArrayProp,
    idProp,
    jsonObjectProp,
    numberProp,
    objectSchema,
    optional,
    stringProp,
} from '../schema-helpers';
import { variantSummary } from '../serializers';

interface UpdateVariantToolInput {
    id: ID;
    input: Omit<UpdateProductVariantInput, 'id'>;
}

const variantTranslationSchema = objectSchema({
    languageCode: stringProp('Language code, e.g. "en".'),
    name: optional(stringProp('Variant name.')),
});

const updateVariantInputSchema = objectSchema({
    sku: optional(stringProp('Stock keeping unit.')),
    translations: optional(arrayProp(variantTranslationSchema, 'Localized variant content to update.')),
    price: optional(numberProp('Price in minor units (e.g. cents).')),
    optionIds: optional(idArrayProp('Product option IDs for this variant.')),
    taxCategoryId: optional(idProp('Tax category ID.')),
    featuredAssetId: optional(idProp('Featured asset ID.')),
    assetIds: optional(idArrayProp('Asset IDs to attach.')),
    stockOnHand: optional(numberProp('Stock on hand.')),
    trackInventory: optional(stringProp('Inventory tracking: "TRUE", "FALSE", or "INHERIT".')),
    enabled: optional(booleanProp('Whether the variant is enabled.')),
    customFields: optional(jsonObjectProp('Variant custom fields.')),
});

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
    inputSchema: objectSchema({
        id: idProp('Variant ID.'),
        input: updateVariantInputSchema,
    }),
})
@Injectable()
export class UpdateVariantTool implements McpToolHandler<UpdateVariantToolInput> {
    constructor(private productVariantService: ProductVariantService) {}

    async execute(ctx: RequestContext, input: UpdateVariantToolInput) {
        const variants = await this.productVariantService.update(ctx, [{ ...input.input, id: input.id }]);
        return { variants: variants.map(variant => variantSummary(variant)) };
    }
}
