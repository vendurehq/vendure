import { assetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';

export const createAssetsDocument = graphql(
    `
        mutation CreateAssets($input: [CreateAssetInput!]!) {
            createAssets(input: $input) {
                __typename
                ...Asset
                ... on Asset {
                    tags {
                        id
                        createdAt
                        updatedAt
                        value
                    }
                }
                ... on ErrorResult {
                    message
                }
            }
        }
    `,
    [assetFragment],
);
