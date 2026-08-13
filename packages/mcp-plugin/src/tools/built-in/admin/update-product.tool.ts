import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { productTranslationSchema } from './translation-schemas';

const updateProductInputSchema = z.strictObject({
    translations: z
        .array(productTranslationSchema)
        .describe('Localized product content to update.')
        .optional(),
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

const updateProductInput = z.strictObject({
    id: z.union([z.string(), z.number()]).describe('Product ID.'),
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
        private productService: ProductService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateProductToolInput) {
        return {
            product: this.serializer.product(
                await this.productService.update(ctx, { ...input.input, id: input.id }),
            ),
        };
    }
}
