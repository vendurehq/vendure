import { Injectable } from '@nestjs/common';
import { CreateProductInput } from '@vendure/common/lib/generated-types';
import { Permission, ProductService, RequestContext } from '@vendure/core';
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

interface CreateProductToolInput {
    input: CreateProductInput;
}

const productTranslationSchema = objectSchema({
    languageCode: stringProp('Language code, e.g. "en".'),
    name: optional(stringProp('Product name.')),
    slug: optional(stringProp('URL slug.')),
    description: optional(stringProp('Product description.')),
});

const createProductInputSchema = objectSchema({
    translations: arrayProp(
        productTranslationSchema,
        'Localized product content. At least one entry with a languageCode is required.',
    ),
    enabled: optional(booleanProp('Whether the product is enabled.')),
    facetValueIds: optional(idArrayProp('Facet value IDs to assign.')),
    assetIds: optional(idArrayProp('Asset IDs to attach.')),
    featuredAssetId: optional(idProp('Featured asset ID.')),
    customFields: optional(jsonObjectProp('Product custom fields.')),
});

@McpTool({
    name: 'create_product',
    toolset: 'admin',
    description: 'Create a new product in the catalog, with its name, slug, description and enabled state.',
    keywords: [
        'add a new product',
        'list a new item for sale',
        'create a catalog entry',
        'add product to the store',
        'make a new listing',
        'put a new item on sale',
    ],
    permissions: [Permission.CreateProduct],
    inputSchema: objectSchema({ input: createProductInputSchema }),
})
@Injectable()
export class CreateProductTool implements McpToolHandler<CreateProductToolInput> {
    constructor(private productService: ProductService) {}

    async execute(ctx: RequestContext, input: CreateProductToolInput) {
        return { product: productSummary(await this.productService.create(ctx, input.input)) };
    }
}
