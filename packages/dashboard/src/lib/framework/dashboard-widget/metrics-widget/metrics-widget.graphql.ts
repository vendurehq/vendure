import { graphql } from '@/vdb/graphql/graphql.js';

export const orderChartDataQuery = graphql(`
    query GetOrderChartData(
        $types: [DashboardMetricType!]!
        $startDate: DateTime!
        $endDate: DateTime!
    ) {
        dashboardMetricSummary(
            input: { types: $types, startDate: $startDate, endDate: $endDate }
        ) {
            type
            entries {
                label
                value
            }
        }
    }
`);
