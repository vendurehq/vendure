import { Injectable } from '@nestjs/common';
import { UpdateProductInput } from '@vendure/common/lib/generated-types';
import { ID, Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import {
    arrayProp,
    booleanProp,
    idArrayProp,
    idProp,
    jsonObjectProp,
    objectSchema,
    optional,
    stringProp,
} from '../schema-helpers';
import { productSummary } from '../serializers';

interface UpdateProductToolInput {
    id: ID;
    input: Omit<UpdateProductInput, 'id'>;
}

const productTranslationSchema = objectSchema({
    languageCode: stringProp('Language code, e.g. "en".'),
    name: optional(stringProp('Product name.')),
    slug: optional(stringProp('URL slug.')),
    description: optional(stringProp('Product description.')),
});

const updateProductInputSchema = objectSchema({
    translations: optional(arrayProp(productTranslationSchema, 'Localized product content to update.')),
    enabled: optional(booleanProp('Whether the product is enabled.')),
    facetValueIds: optional(idArrayProp('Facet value IDs to assign.')),
    assetIds: optional(idArrayProp('Asset IDs to attach.')),
    featuredAssetId: optional(idProp('Featured asset ID.')),
    customFields: optional(jsonObjectProp('Product custom fields.')),
});

@McpTool({
    name: 'update_product',
    toolset: 'admin',
    description:
        "Update an existing product's details, such as its name, slug, description or enabled state.",
    keywords: [
        "edit a product's details",
        'change product info',
        'update a listing',
        'modify item description',
        'fix product data',
        'edit a catalog entry',
    ],
    permissions: [Permission.UpdateProduct],
    inputSchema: objectSchema({
        id: idProp('Product ID.'),
        input: updateProductInputSchema,
    }),
})
@Injectable()
export class UpdateProductTool implements McpToolHandler<UpdateProductToolInput> {
    constructor(private productService: ProductService) {}

    async execute(ctx: RequestContext, input: UpdateProductToolInput) {
        return {
            product: productSummary(await this.productService.update(ctx, { ...input.input, id: input.id })),
        };
    }
}
