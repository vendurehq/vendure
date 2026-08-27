import { Injectable } from '@nestjs/common';
import { CollectionService, Permission, ProductService, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpCatalogQueryService } from '../catalog-query.service';
import { idSchema } from '../id-schema';
import { page, paginationFields, productSearchWords, publicProductListOptions } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

import { collectionLookup, findPublicCollection, noCollectionMessage } from './collection-lookup';

const searchProductsInput = z
    .strictObject({
        query: z.string().describe('Text to look up in product names and slugs.').optional(),
        collectionId: idSchema
            .describe(
                'Only products in this collection. Take the id from list_collections or get_collection.',
            )
            .optional(),
        collectionSlug: z
            .string()
            .describe(
                'Only products in this collection. Take the slug from list_collections or get_collection.',
            )
            .optional(),
        ...paginationFields('products'),
    })
    .refine(input => !(input.collectionId != null && input.collectionSlug != null), {
        message: 'Pass collectionId or collectionSlug, not both.',
    });

type SearchProductsInput = z.infer<typeof searchProductsInput>;

@McpTool({
    name: 'search_products',
    toolset: 'shop',
    description:
        'Find products by name, optionally within one collection. Every word must appear in the name ' +
        'or slug, and descriptions are not searched. If nothing comes back, try fewer or more general words.',
    keywords: [
        'find a product',
        'search the store',
        'do you sell',
        'look for an item by name',
        'search for something to buy',
        'hunt for a product',
        'products in a category',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: searchProductsInput,
})
@Injectable()
export class SearchProductsTool implements McpToolHandler<SearchProductsInput> {
    constructor(
        private productService: ProductService,
        private collectionService: CollectionService,
        private catalog: McpCatalogQueryService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SearchProductsInput) {
        let productIds: string[] | undefined;
        const lookup = collectionLookup(input.collectionId, input.collectionSlug);
        if (lookup) {
            const collection = await findPublicCollection(this.collectionService, ctx, lookup);
            if (!collection) {
                return { ...page([], 0, input), message: noCollectionMessage(lookup) };
            }
            productIds = await this.catalog.productIdsInCollection(ctx, collection.id);
        }

        const words = productSearchWords(input.query);
        const singularWords = productSearchWords(input.query, true);
        let result = await this.findProducts(ctx, input, words, productIds);
        // A shopper's plural never appears inside a singular product name, so "cameras" misses
        // "Instant Camera". Retrying with the plural endings trimmed off only ever widens the
        // match, and it runs only once the words as typed have already come back empty.
        if (result.totalItems === 0 && singularWords.join(' ') !== words.join(' ')) {
            result = await this.findProducts(ctx, input, singularWords, productIds);
        }
        const variantsByProduct = await this.catalog.variantsByProductId(
            ctx,
            result.items.map(product => product.id),
            { includeDisabled: false },
        );
        return page(
            result.items.map(product =>
                this.serializer.productListItem(product, variantsByProduct.get(String(product.id)) ?? []),
            ),
            result.totalItems,
            input,
        );
    }

    private findProducts(
        ctx: RequestContext,
        input: SearchProductsInput,
        words: string[],
        productIds?: string[],
    ) {
        return this.productService.findAll(ctx, publicProductListOptions(input, words, productIds), [
            'featuredAsset',
        ]);
    }
}
