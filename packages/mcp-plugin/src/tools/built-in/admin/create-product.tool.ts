import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

import { productTranslationSchema } from './translation-schemas';

const createProductInputSchema = z.strictObject({
    translations: z
        .array(productTranslationSchema)
        .describe('Localized product content. At least one entry with a languageCode is required.'),
    enabled: z.boolean().describe('Whether the product is enabled.').optional(),
    facetValueIds: z
        .array(idSchema.describe('Vendure ID.'))
        .describe('Facet value IDs to assign.')
        .optional(),
    assetIds: z.array(idSchema.describe('Vendure ID.')).describe('Asset IDs to attach.').optional(),
    featuredAssetId: idSchema.describe('Featured asset ID.').optional(),
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
    constructor(
        private productService: ProductService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateProductToolInput) {
        return { product: this.serializer.product(await this.productService.create(ctx, input.input)) };
    }
}
