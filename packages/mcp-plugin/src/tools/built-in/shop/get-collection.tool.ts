import { Injectable } from '@nestjs/common';
import { CollectionService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

import { collectionLookup, findPublicCollection, noCollectionMessage } from './collection-lookup';

const getCollectionInput = z.strictObject({
    id: idSchema.describe('Collection ID.').optional(),
    slug: shortText.describe('Collection slug, used when ID is omitted.').optional(),
});

type GetCollectionInput = z.infer<typeof getCollectionInput>;

@McpTool({
    name: 'get_collection',
    toolset: 'shop',
    description: 'Get a public collection by ID or slug.',
    keywords: [
        'show me this category',
        'open a product group',
        'browse this department',
        'view a category page',
        'details of a collection',
        "what's in this category",
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: getCollectionInput,
})
@Injectable()
export class ShopGetCollectionTool implements McpToolHandler<GetCollectionInput> {
    constructor(
        private collectionService: CollectionService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetCollectionInput) {
        const lookup = collectionLookup(input.id, input.slug);
        if (!lookup) {
            return { collection: null, message: 'Pass id or slug.' };
        }
        const collection = await findPublicCollection(this.collectionService, ctx, lookup, ['featuredAsset']);
        if (!collection) {
            return { collection: null, message: noCollectionMessage(lookup) };
        }
        return { collection: this.serializer.collection(collection) };
    }
}
