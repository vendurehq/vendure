import { Injectable } from '@nestjs/common';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { productSummary } from '../serializers';

const productTranslationSchema = z.strictObject({
    // Cast is type-only (no runtime effect, schema still emits `type: "string"`): the generated
    // service call expects the real LanguageCode enum, but the JSON schema for this field is a
    // plain string, so z.infer alone would type it as `string`.
    languageCode: z.string().describe('Language code, e.g. "en".') as unknown as z.ZodType<LanguageCode>,
    name: z.string().describe('Product name.').optional(),
    slug: z.string().describe('URL slug.').optional(),
    description: z.string().describe('Product description.').optional(),
});

const createProductInputSchema = z.strictObject({
    translations: z
        .array(productTranslationSchema)
        .describe('Localized product content. At least one entry with a languageCode is required.'),
    enabled: z.boolean().describe('Whether the product is enabled.').optional(),
    facetValueIds: z
        .array(z.union([z.string(), z.number()]).describe('Vendure ID.'))
        .describe('Facet value IDs to assign.')
        .optional(),
    assetIds: z
        .array(z.union([z.string(), z.number()]).describe('Vendure ID.'))
        .describe('Asset IDs to attach.')
        .optional(),
    featuredAssetId: z.union([z.string(), z.number()]).describe('Featured asset ID.').optional(),
    customFields: z.looseObject({}).describe('Product custom fields.').optional(),
});

const createProductInput = z.strictObject({ input: createProductInputSchema });

type CreateProductToolInput = z.infer<typeof createProductInput>;

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
    behavior: 'mutating',
    inputSchema: createProductInput,
})
@Injectable()
export class CreateProductTool implements McpToolHandler<CreateProductToolInput> {
    constructor(private productService: ProductService) {}

    async execute(ctx: RequestContext, input: CreateProductToolInput) {
        return { product: productSummary(await this.productService.create(ctx, input.input)) };
    }
}
