import { graphql } from '@/vdb/graphql/graphql.js';

export const topProductsOrdersQuery = graphql(`
    query GetTopProductsOrders($options: OrderListOptions) {
        orders(options: $options) {
            totalItems
            items {
                id
                lines {
                    id
                    quantity
                    linePriceWithTax
                    productVariant {
                        id
                        name
                        sku
                    }
                }
            }
        }
    }
`);
