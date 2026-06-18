import { assetFragment } from './fragments-admin';
import { graphql } from './graphql-admin';

export const createAssetsDocument = graphql(
    `
        mutation CreateAssets($input: [CreateAssetInput!]!) {
            createAssets(input: $input) {
                ...Asset
            }
        }
    `,
    [assetFragment],
);

export const deleteAssetDocument = graphql(`
    mutation DeleteAsset($input: DeleteAssetInput!) {
        deleteAsset(input: $input) {
            result
        }
    }
`);
