import { Injectable } from '@nestjs/common';
import { CollectionService, ID, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { idProp, objectSchema, optional, stringProp } from '../schema-helpers';
import { collectionSummary } from '../serializers';

interface GetCollectionInput {
    id?: ID;
    slug?: string;
}

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
    inputSchema: objectSchema({
        id: optional(idProp('Collection ID.')),
        slug: optional(stringProp('Collection slug, used when ID is omitted.')),
    }),
})
@Injectable()
export class ShopGetCollectionTool implements McpToolHandler<GetCollectionInput> {
    constructor(private collectionService: CollectionService) {}

    async execute(ctx: RequestContext, input: GetCollectionInput) {
        const collection =
            input.id != null
                ? await this.collectionService.findOne(ctx, input.id, ['featuredAsset'])
                : await this.collectionService.findOneBySlug(ctx, input.slug ?? '', ['featuredAsset']);
        return { collection: collection && !collection.isPrivate ? collectionSummary(collection) : null };
    }
}
