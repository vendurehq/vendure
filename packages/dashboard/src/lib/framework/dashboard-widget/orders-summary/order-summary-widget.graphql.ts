import { graphql } from '@/vdb/graphql/graphql.js';

export const orderSummaryQuery = graphql(`
    query GetOrderSummaryMetrics($start: DateTime!, $end: DateTime!) {
        dashboardMetricSummary(
            input: { types: [OrderCount, OrderTotal], startDate: $start, endDate: $end }
        ) {
            type
            entries {
                value
            }
        }
    }
`);
