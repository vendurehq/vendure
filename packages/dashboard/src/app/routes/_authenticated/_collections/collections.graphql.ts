import { api } from '@/vdb/graphql/api.js';
import {
    assetFragment,
    configurableOperationDefFragment,
    configurableOperationFragment,
} from '@/vdb/graphql/fragments.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { DefinedInitialDataOptions, queryOptions } from '@tanstack/react-query';

export const collectionListDocument = graphql(
    `
        query CollectionList($options: CollectionListOptions) {
            collections(options: $options) {
                items {
                    id
                    createdAt
                    updatedAt
                    featuredAsset {
                        ...Asset
                    }
                    name
                    slug
                    description
                    breadcrumbs {
                        id
                        name
                        slug
                    }
                    children {
                        id
                        name
                    }
                    position
                    isPrivate
                    parentId
                    productVariantCount
                }
                totalItems
            }
        }
    `,
    [assetFragment],
);

export const collectionDetailDocument = graphql(
    `
        query CollectionDetail($id: ID!) {
            collection(id: $id) {
                id
                createdAt
                updatedAt
                name
                slug
                description
                isPrivate
                languageCode
                breadcrumbs {
                    id
                    name
                    slug
                }
                featuredAsset {
                    ...Asset
                }
                assets {
                    ...Asset
                }
                inheritFilters
                filters {
                    ...ConfigurableOperation
                }
                translations {
                    id
                    languageCode
                    name
                    slug
                    description
                }
                parent {
                    id
                    name
                }
                children {
                    id
                    name
                }
                customFields
            }
        }
    `,
    [assetFragment, configurableOperationFragment],
);

export const createCollectionDocument = graphql(`
    mutation CreateCollection($input: CreateCollectionInput!) {
        createCollection(input: $input) {
            id
        }
    }
`);

export const updateCollectionDocument = graphql(`
    mutation UpdateCollection($input: UpdateCollectionInput!) {
        updateCollection(input: $input) {
            id
        }
    }
`);

export const deleteCollectionDocument = graphql(`
    mutation DeleteCollection($id: ID!) {
        deleteCollection(id: $id) {
            result
            message
        }
    }
`);

export const getCollectionFiltersDocument = graphql(
    `
        query GetCollectionFilters {
            collectionFilters {
                ...ConfigurableOperationDef
            }
        }
    `,
    [configurableOperationDefFragment],
);

export const getCollectionFiltersQueryOptions = queryOptions({
    queryKey: ['getCollectionFilters'],
    queryFn: () => api.query(getCollectionFiltersDocument),
}) as DefinedInitialDataOptions<ResultOf<typeof getCollectionFiltersDocument>>;

export const assignCollectionToChannelDocument = graphql(`
    mutation AssignCollectionsToChannel($input: AssignCollectionsToChannelInput!) {
        assignCollectionsToChannel(input: $input) {
            id
        }
    }
`);

export const removeCollectionFromChannelDocument = graphql(`
    mutation RemoveCollectionsFromChannel($input: RemoveCollectionsFromChannelInput!) {
        removeCollectionsFromChannel(input: $input) {
            id
        }
    }
`);

export const deleteCollectionsDocument = graphql(`
    mutation DeleteCollections($ids: [ID!]!) {
        deleteCollections(ids: $ids) {
            result
            message
        }
    }
`);

export const moveCollectionDocument = graphql(`
    mutation MoveCollection($input: MoveCollectionInput!) {
        moveCollection(input: $input) {
            id
            position
        }
    }
`);

export const collectionListForMoveDocument = graphql(`
    query CollectionListForMove($options: CollectionListOptions) {
        collections(options: $options) {
            items {
                id
                name
                slug
                breadcrumbs {
                    id
                    name
                    slug
                }
                children {
                    id
                }
                position
                isPrivate
                parentId
            }
            totalItems
        }
    }
`);
