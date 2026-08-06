import { Injectable } from '@nestjs/common';
import { CreateProductVariantInput } from '@vendure/common/lib/generated-types';
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

interface CreateVariantToolInput {
    productId: ID;
    input: Omit<CreateProductVariantInput, 'productId'>;
}

const variantTranslationSchema = objectSchema({
    languageCode: stringProp('Language code, e.g. "en".'),
    name: optional(stringProp('Variant name.')),
});

const createVariantInputSchema = objectSchema({
    sku: stringProp('Stock keeping unit.'),
    translations: arrayProp(variantTranslationSchema, 'Localized variant content.'),
    price: optional(numberProp('Price in minor units (e.g. cents).')),
    optionIds: optional(idArrayProp('Product option IDs for this variant.')),
    taxCategoryId: optional(idProp('Tax category ID.')),
    featuredAssetId: optional(idProp('Featured asset ID.')),
    assetIds: optional(idArrayProp('Asset IDs to attach.')),
    stockOnHand: optional(numberProp('Initial stock on hand.')),
    trackInventory: optional(stringProp('Inventory tracking: "TRUE", "FALSE", or "INHERIT".')),
    enabled: optional(booleanProp('Whether the variant is enabled.')),
    customFields: optional(jsonObjectProp('Variant custom fields.')),
});

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
    inputSchema: objectSchema({
        productId: idProp('Parent product ID.'),
        input: createVariantInputSchema,
    }),
})
@Injectable()
export class CreateVariantTool implements McpToolHandler<CreateVariantToolInput> {
    constructor(private productVariantService: ProductVariantService) {}

    async execute(ctx: RequestContext, input: CreateVariantToolInput) {
        const variants = await this.productVariantService.create(ctx, [
            { ...input.input, productId: input.productId },
        ]);
        return { variants: variants.map(variant => variantSummary(variant)) };
    }
}
