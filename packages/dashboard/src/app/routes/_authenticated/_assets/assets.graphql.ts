import { assetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';

export const assetDetailDocument = graphql(
    `
        query AssetDetail($id: ID!) {
            asset(id: $id) {
                ...Asset
                tags {
                    id
                    value
                }
                customFields
            }
        }
    `,
    [assetFragment],
);

export const assetUpdateDocument = graphql(`
    mutation AssetUpdate($input: UpdateAssetInput!) {
        updateAsset(input: $input) {
            id
        }
    }
`);

export const deleteAssetsDocument = graphql(`
    mutation DeleteAssets($input: DeleteAssetsInput!) {
        deleteAssets(input: $input) {
            ... on DeletionResponse {
                result
                message
            }
        }
    }
`);

export const tagListDocument = graphql(`
    query TagList($options: TagListOptions) {
        tags(options: $options) {
            items {
                id
                value
            }
            totalItems
        }
    }
`);

export const createTagDocument = graphql(`
    mutation CreateTag($input: CreateTagInput!) {
        createTag(input: $input) {
            id
            value
        }
    }
`);

export const updateTagDocument = graphql(`
    mutation UpdateTag($input: UpdateTagInput!) {
        updateTag(input: $input) {
            id
            value
        }
    }
`);

export const deleteTagDocument = graphql(`
    mutation DeleteTag($id: ID!) {
        deleteTag(id: $id) {
            result
            message
        }
    }
`);
