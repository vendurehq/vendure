import { graphql } from '@/vdb/graphql/graphql.js';

export const orderSummaryQuery = graphql(`
    query GetOrderSummaryMetrics($start: DateTime!, $end: DateTime!, $refresh: Boolean) {
        dashboardMetricSummary(
            input: {
                types: [OrderCount, OrderTotal]
                startDate: $start
                endDate: $end
                refresh: $refresh
            }
        ) {
            type
            entries {
                value
            }
        }
    }
`);
