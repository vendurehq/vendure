import { graphql } from '@/vdb/graphql/graphql.js';

export const orderSummaryQuery = graphql(`
    query GetOrderSummaryMetrics($start: DateTime!, $end: DateTime!) {
        dashboardMetricSummary(input: { types: [OrderCount, OrderTotal], startDate: $start, endDate: $end }) {
            type
            entries {
                value
            }
        }
    }
`);

/**
 * The order count and total of a period and of the period before it, in one request, so the
 * two always arrive together.
 */
export const orderSummaryComparisonQuery = graphql(`
    query GetOrderSummaryComparison(
        $start: DateTime!
        $end: DateTime!
        $previousStart: DateTime!
        $previousEnd: DateTime!
    ) {
        current: dashboardMetricSummary(
            input: { types: [OrderCount, OrderTotal], startDate: $start, endDate: $end }
        ) {
            type
            entries {
                value
            }
        }
        previous: dashboardMetricSummary(
            input: { types: [OrderCount, OrderTotal], startDate: $previousStart, endDate: $previousEnd }
        ) {
            type
            entries {
                value
            }
        }
    }
`);
