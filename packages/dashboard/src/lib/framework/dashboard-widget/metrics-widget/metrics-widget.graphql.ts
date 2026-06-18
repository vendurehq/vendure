import { graphql } from '@/vdb/graphql/graphql.js';

export const orderChartDataQuery = graphql(`
    query GetOrderChartData(
        $refresh: Boolean
        $types: [DashboardMetricType!]!
        $startDate: DateTime!
        $endDate: DateTime!
    ) {
        dashboardMetricSummary(
            input: { types: $types, refresh: $refresh, startDate: $startDate, endDate: $endDate }
        ) {
            type
            entries {
                label
                value
            }
        }
    }
`);
