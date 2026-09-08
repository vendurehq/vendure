import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCustomFieldInputService } from '../custom-field-input.service';
import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

import { productFieldsSchema } from './entity-field-schemas';
import { productTranslationSchema } from './translation-schemas';

const updateProductInputSchema = productFieldsSchema.extend({
    translations: z
        .array(productTranslationSchema)
        .describe('Localized product content to update.')
        .optional(),
});

const updateProductInput = z.strictObject({
    id: idSchema.describe('Product ID.'),
    input: updateProductInputSchema,
});

type UpdateProductToolInput = z.infer<typeof updateProductInput>;

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
    behavior: 'mutating',
    inputSchema: updateProductInput,
})
@Injectable()
export class UpdateProductTool implements McpToolHandler<UpdateProductToolInput> {
    constructor(
        private readonly productService: ProductService,
        private readonly customFieldInput: McpCustomFieldInputService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateProductToolInput) {
        await this.customFieldInput.assertWritable(ctx, 'Product', input.input.customFields);
        return {
            product: this.serializer.product(
                await this.productService.update(ctx, { ...input.input, id: input.id }),
            ),
        };
    }
}
