import { Injectable } from '@nestjs/common';
import { CollectionService, idsAreEqual, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { page, paginationFields, publicCollectionListOptions, slicePage } from '../order-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listCollectionsInput = z.strictObject({
    ...paginationFields('collections'),
    parentId: idSchema.describe('Return the children of this collection.').optional(),
});

type ListCollectionsInput = z.infer<typeof listCollectionsInput>;

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
    constructor(
        private collectionService: CollectionService,
        private serializer: McpToolSerializerService,
    ) {}

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
            const items = slicePage(visibleChildren, input).map(collection =>
                this.serializer.collection(collection),
            );
            return page(items, visibleChildren.length, input);
        }
        const result = await this.collectionService.findAll(ctx, publicCollectionListOptions(input), [
            'featuredAsset',
        ]);
        return page(
            result.items.map(collection => this.serializer.collection(collection)),
            result.totalItems,
            input,
        );
    }
}
