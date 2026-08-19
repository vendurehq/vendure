import { Injectable } from '@nestjs/common';
import { Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { page, paginationFields, productSearchWords, publicProductListOptions } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const searchProductsInput = z.strictObject({
    query: z.string().describe('Text to look up in product names and slugs.').optional(),
    ...paginationFields('products'),
});

type SearchProductsInput = z.infer<typeof searchProductsInput>;

@McpTool({
    name: 'search_products',
    toolset: 'shop',
    description:
        'Find products by name. Every word must appear in the name or slug, and descriptions are ' +
        'not searched. If nothing comes back, try fewer or more general words.',
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
        const words = productSearchWords(input.query);
        const singularWords = productSearchWords(input.query, true);
        let result = await this.findProducts(ctx, input, words);
        // A shopper's plural never appears inside a singular product name, so "cameras" misses
        // "Instant Camera". Retrying with the plural endings trimmed off only ever widens the
        // match, and it runs only once the words as typed have already come back empty.
        if (result.totalItems === 0 && singularWords.join(' ') !== words.join(' ')) {
            result = await this.findProducts(ctx, input, singularWords);
        }
        return page(
            result.items.map(product => this.serializer.product(product)),
            result.totalItems,
            input,
        );
    }

    private findProducts(ctx: RequestContext, input: SearchProductsInput, words: string[]) {
        return this.productService.findAll(ctx, publicProductListOptions(input, words), ['featuredAsset']);
    }
}
