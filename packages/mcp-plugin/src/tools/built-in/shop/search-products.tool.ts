import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { page, publicProductListOptions } from '../order-helpers';
import { McpToolSerializerService } from '../serializer.service';

const searchProductsInput = z.strictObject({
    query: z.string().describe('Text to look up in product names and slugs.').optional(),
    limit: z.number().describe('Maximum number of products to return.').optional(),
    offset: z.number().describe('Number of products to skip.').optional(),
});

type SearchProductsInput = z.infer<typeof searchProductsInput> & Record<string, unknown>;

@McpTool({
    name: 'search_products',
    toolset: 'shop',
    description:
        'Find products by name. The query is matched as literal text inside product names and ' +
        'slugs, so pass a single word in its singular form: "camera" finds "Instant Camera", ' +
        'while "cameras" or "camera bags" find nothing. If a search comes back empty, try a ' +
        'shorter or more general word before telling the shopper the item is not stocked.',
    keywords: [
        'find a product',
        'search the store',
        'do you sell',
        'look for an item by name',
        'search for something to buy',
        'hunt for a product',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: searchProductsInput,
})
@Injectable()
export class SearchProductsTool implements McpToolHandler<SearchProductsInput> {
    constructor(
        private productService: ProductService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SearchProductsInput) {
        const result = await this.productService.findAll(ctx, publicProductListOptions(input), [
            'featuredAsset',
        ]);
        return page(
            result.items.map(product => this.serializer.product(product)),
            result.totalItems,
            input,
        );
    }
}
