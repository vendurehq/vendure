import { Injectable } from '@nestjs/common';
import { CollectionService, idsAreEqual, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { page, publicCollectionListOptions } from '../order-helpers';
import { collectionSummary } from '../serializers';

const listCollectionsInput = z.strictObject({
    limit: z.number().describe('Maximum number of collections to return.').optional(),
    offset: z.number().describe('Number of collections to skip.').optional(),
    parentId: z
        .union([z.string(), z.number()])
        .describe('Return the children of this collection.')
        .optional(),
});

type ListCollectionsInput = z.infer<typeof listCollectionsInput> & Record<string, unknown>;

@McpTool({
    name: 'list_collections',
    toolset: 'shop',
    description: 'List public collections with pagination.',
    keywords: [
        'browse all categories',
        'what departments do you have',
        'show me your product groups',
        'list of shop categories',
        'see every collection',
        'how is the store organized',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: listCollectionsInput,
})
@Injectable()
export class ShopListCollectionsTool implements McpToolHandler<ListCollectionsInput> {
    constructor(private collectionService: CollectionService) {}

    async execute(ctx: RequestContext, input: ListCollectionsInput) {
        if (input.parentId != null) {
            const parent = await this.collectionService.findOne(ctx, input.parentId);
            if (!parent || parent.isPrivate) {
                return page([], 0, input);
            }
            const children = await this.collectionService.getChildren(ctx, input.parentId);
            const publicChildren = children.filter(collection => !collection.isPrivate);
            const channelChildren = await this.collectionService.findByIds(
                ctx,
                publicChildren.map(collection => collection.id),
            );
            const visibleChildren = publicChildren
                .map(collection =>
                    channelChildren.find(channelCollection =>
                        idsAreEqual(channelCollection.id, collection.id),
                    ),
                )
                .filter((collection): collection is (typeof channelChildren)[number] => collection != null);
            const offset = input.offset ?? 0;
            const limit = input.limit ?? 25;
            const items = visibleChildren
                .slice(offset, offset + limit)
                .map(collection => collectionSummary(collection));
            return page(items, visibleChildren.length, input);
        }
        const result = await this.collectionService.findAll(ctx, publicCollectionListOptions(input), [
            'featuredAsset',
        ]);
        return page(
            result.items.map(collection => collectionSummary(collection)),
            result.totalItems,
            input,
        );
    }
}
