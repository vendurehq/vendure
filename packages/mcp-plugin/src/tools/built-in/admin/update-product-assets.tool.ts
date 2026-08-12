import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { productSummary } from '../serializers';

const updateProductAssetsInput = z.strictObject({
    id: z.union([z.string(), z.number()]).describe('Product ID.'),
    assetIds: z
        .array(z.union([z.string(), z.number()]).describe('Vendure ID.'))
        .describe('Ordered asset IDs to set on the product.'),
    featuredAssetId: z.union([z.string(), z.number()]).describe('Featured asset ID.').optional(),
});

type UpdateProductAssetsInput = z.infer<typeof updateProductAssetsInput>;

@McpTool({
    name: 'update_product_assets',
    toolset: 'admin',
    description: 'Change which images or media assets a product uses, and which one is its featured image.',
    keywords: [
        "change a product's images",
        'set the product photos',
        'update product pictures',
        'assign a featured image',
        'swap out product media',
        'attach images to a product',
    ],
    permissions: [Permission.UpdateProduct],
    behavior: 'mutating',
    inputSchema: updateProductAssetsInput,
})
@Injectable()
export class UpdateProductAssetsTool implements McpToolHandler<UpdateProductAssetsInput> {
    constructor(private productService: ProductService) {}

    async execute(ctx: RequestContext, input: UpdateProductAssetsInput) {
        return {
            product: productSummary(
                await this.productService.update(ctx, {
                    id: input.id,
                    assetIds: input.assetIds,
                    featuredAssetId: input.featuredAssetId,
                }),
            ),
        };
    }
}
