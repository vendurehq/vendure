import { gql } from 'apollo-angular';

import { ASSET_FRAGMENT } from './product-definitions';
import { CONFIGURABLE_OPERATION_DEF_FRAGMENT, CONFIGURABLE_OPERATION_FRAGMENT } from './shared-definitions';

export const GET_COLLECTION_FILTERS = gql`
    query GetCollectionFilters {
        collectionFilters {
            ...ConfigurableOperationDef
        }
    }
    ${CONFIGURABLE_OPERATION_DEF_FRAGMENT}
`;

export const COLLECTION_FRAGMENT = gql`
    fragment Collection on Collection {
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
    }
    ${ASSET_FRAGMENT}
    ${CONFIGURABLE_OPERATION_FRAGMENT}
`;

export const COLLECTION_FOR_LIST_FRAGMENT = gql`
    fragment CollectionForList on Collection {
        id
        createdAt
        updatedAt
        name
        slug
        position
        isPrivate
        breadcrumbs {
            id
            name
            slug
        }
        featuredAsset {
            ...Asset
        }
        parentId
        children {
            id
        }
    }
    ${ASSET_FRAGMENT}
`;

export const GET_COLLECTION_LIST = gql`
    query GetCollectionList($options: CollectionListOptions) {
        collections(options: $options) {
            items {
                ...CollectionForList
            }
            totalItems
        }
    }
    ${COLLECTION_FOR_LIST_FRAGMENT}
`;

export const CREATE_COLLECTION = gql`
    mutation CreateCollection($input: CreateCollectionInput!) {
        createCollection(input: $input) {
            ...Collection
        }
    }
    ${COLLECTION_FRAGMENT}
`;

export const UPDATE_COLLECTION = gql`
    mutation UpdateCollection($input: UpdateCollectionInput!) {
        updateCollection(input: $input) {
            ...Collection
        }
    }
    ${COLLECTION_FRAGMENT}
`;

export const MOVE_COLLECTION = gql`
    mutation MoveCollection($input: MoveCollectionInput!) {
        moveCollection(input: $input) {
            ...Collection
        }
    }
    ${COLLECTION_FRAGMENT}
`;

export const DELETE_COLLECTION = gql`
    mutation DeleteCollection($id: ID!) {
        deleteCollection(id: $id) {
            result
            message
        }
    }
`;

export const DELETE_COLLECTIONS = gql`
    mutation DeleteCollections($ids: [ID!]!) {
        deleteCollections(ids: $ids) {
            result
            message
        }
    }
`;

export const GET_COLLECTION_CONTENTS = gql`
    query GetCollectionContents($id: ID!, $options: ProductVariantListOptions) {
        collection(id: $id) {
            id
            name
            productVariants(options: $options) {
                items {
                    id
                    createdAt
                    updatedAt
                    productId
                    name
                    sku
                }
                totalItems
            }
        }
    }
`;

export const PREVIEW_COLLECTION_CONTENTS = gql`
    query PreviewCollectionContents(
        $input: PreviewCollectionVariantsInput!
        $options: ProductVariantListOptions
    ) {
        previewCollectionVariants(input: $input, options: $options) {
            items {
                id
                createdAt
                updatedAt
                productId
                name
                sku
            }
            totalItems
        }
    }
`;

export const ASSIGN_COLLECTIONS_TO_CHANNEL = gql`
    mutation AssignCollectionsToChannel($input: AssignCollectionsToChannelInput!) {
        assignCollectionsToChannel(input: $input) {
            id
            name
        }
    }
`;

export const REMOVE_COLLECTIONS_FROM_CHANNEL = gql`
    mutation RemoveCollectionsFromChannel($input: RemoveCollectionsFromChannelInput!) {
        removeCollectionsFromChannel(input: $input) {
            id
            name
        }
    }
`;
