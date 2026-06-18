import { DocumentNode } from 'graphql';
import gql from 'graphql-tag';

export const stockStatusExtension = gql`
    extend type SearchResult {
        inStock: Boolean!
    }

    extend input SearchInput {
        inStock: Boolean
    }
`;
