import { graphql } from './graphql-admin';

export const assetFragment = graphql(`
    fragment Asset on Asset {
        id
        name
        source
        preview
        focalPoint {
            x
            y
        }
    }
`);
