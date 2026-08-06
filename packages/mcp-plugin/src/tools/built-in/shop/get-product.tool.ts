import { Injectable } from '@nestjs/common';
import { ID, Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { idProp, objectSchema, optional, stringProp } from '../schema-helpers';
import { productSummary } from '../serializers';

interface GetProductInput {
    id?: ID;
    slug?: string;
}

@McpTool({
    name: 'get_product',
    toolset: 'shop',
    description: 'Get an enabled product by ID or slug.',
    keywords: [
        'tell me about this item',
        'show me this product',
        'product details for shoppers',
        'view an item page',
        'info on a specific product',
        'see this thing you sell',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: objectSchema({
        id: optional(idProp('Product ID.')),
        slug: optional(stringProp('Product slug, used when ID is omitted.')),
    }),
})
@Injectable()
export class ShopGetProductTool implements McpToolHandler<GetProductInput> {
    constructor(private productService: ProductService) {}

    async execute(ctx: RequestContext, input: GetProductInput) {
        const product =
            input.id != null
                ? await this.productService.findOne(ctx, input.id, ['featuredAsset', 'assets'])
                : await this.productService.findOneBySlug(ctx, input.slug ?? '', ['featuredAsset', 'assets']);
        return { product: product?.enabled === true ? productSummary(product) : null };
    }
}
