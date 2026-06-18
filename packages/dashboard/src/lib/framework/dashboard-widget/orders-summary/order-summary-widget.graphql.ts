import { graphql } from '@/vdb/graphql/graphql.js';

export const orderSummaryQuery = graphql(`
    query GetOrderSummary($start: DateTime!, $end: DateTime!) {
        orders(options: { filter: { orderPlacedAt: { between: { start: $start, end: $end } } } }) {
            totalItems
            items {
                id
                totalWithTax
                currencyCode
            }
        }
    }
`);
