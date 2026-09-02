import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCustomFieldInputService } from '../custom-field-input.service';
import { idSchema, MAX_ID_LIST_LENGTH } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

import { productTranslationSchema } from './translation-schemas';

const createProductInputSchema = z.strictObject({
    translations: z
        .array(productTranslationSchema)
        .describe('Localized product content. At least one entry with a languageCode is required.'),
    enabled: z.boolean().describe('Whether the product is enabled.').optional(),
    facetValueIds: z
        .array(idSchema.describe('Vendure ID.'))
        .max(MAX_ID_LIST_LENGTH)
        .describe('Facet value IDs to assign.')
        .optional(),
    assetIds: z
        .array(idSchema.describe('Vendure ID.'))
        .max(MAX_ID_LIST_LENGTH)
        .describe('Asset IDs to attach.')
        .optional(),
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
        private customFieldInput: McpCustomFieldInputService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateProductToolInput) {
        await this.customFieldInput.assertWritable(ctx, 'Product', input.input.customFields);
        return { product: this.serializer.product(await this.productService.create(ctx, input.input)) };
    }
}
