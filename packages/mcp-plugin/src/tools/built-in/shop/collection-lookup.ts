import { SortOrder } from '@vendure/common/lib/generated-types';
import {
    Collection,
    CollectionService,
    ID,
    ListQueryOptions,
    RelationPaths,
    RequestContext,
} from '@vendure/core';

import { type ListInput, listOptions } from '../list-helpers';

type CollectionLookup = { kind: 'id'; value: ID } | { kind: 'slug'; value: string };

export function collectionLookup(id: ID | undefined, slug: string | undefined): CollectionLookup | undefined {
    if (id != null) {
        return { kind: 'id', value: id };
    }
    if (slug != null) {
        return { kind: 'slug', value: slug };
    }
    return undefined;
}

// A private collection is hidden from shoppers, so it counts as unknown here too.
export async function findPublicCollection(
    collectionService: CollectionService,
    ctx: RequestContext,
    lookup: CollectionLookup,
    relations: RelationPaths<Collection> = [],
): Promise<Collection | undefined> {
    const collection =
        lookup.kind === 'id'
            ? await collectionService.findOne(ctx, lookup.value, relations)
            : await collectionService.findOneBySlug(ctx, lookup.value, relations);
    return collection && !collection.isPrivate ? collection : undefined;
}

/** The one wording every shop tool uses when the lookup found no public collection. */
export function noCollectionMessage(lookup: CollectionLookup): string {
    return `No collection with ${lookup.kind} ${String(lookup.value)}.`;
}

export function publicCollectionListOptions(input: ListInput): ListQueryOptions<Collection> {
    const options = listOptions<Collection>({ limit: input.limit, offset: input.offset });
    return {
        ...options,
        sort: { position: SortOrder.ASC, id: SortOrder.ASC },
        filter: {
            isPrivate: { eq: false },
        },
    };
}
