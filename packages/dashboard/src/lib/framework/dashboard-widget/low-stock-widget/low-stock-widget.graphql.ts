import { graphql } from '@/vdb/graphql/graphql.js';

export const lowStockVariantsQuery = graphql(`
    query GetLowStockVariants($options: ProductVariantListOptions) {
        productVariants(options: $options) {
            totalItems
            items {
                id
                name
                sku
                stockOnHand
                stockAllocated
            }
        }
    }
`);
