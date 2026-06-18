import { graphql } from '@/vdb/graphql/graphql.js';

export const latestOrderItemFragment = graphql(`
    fragment LatestOrderItem on Order {
        id
        createdAt
        updatedAt
        type
        orderPlacedAt
        code
        state
        total
        totalWithTax
        currencyCode
        customer {
            id
            firstName
            lastName
        }
    }
`);

export const latestOrdersQuery = graphql(
    `
        query GetLatestOrders($options: OrderListOptions) {
            orders(options: $options) {
                items {
                    ...LatestOrderItem
                }
                totalItems
            }
        }
    `,
    [latestOrderItemFragment],
);
