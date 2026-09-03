import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCustomFieldInputService } from '../custom-field-input.service';
import { McpToolSerializerService } from '../serializer.service';

import { productFieldsSchema } from './entity-field-schemas';
import { productTranslationSchema } from './translation-schemas';

const createProductInputSchema = productFieldsSchema.extend({
    translations: z
        .array(productTranslationSchema)
        .describe('Localized product content. At least one entry with a languageCode is required.'),
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
