import gql from 'graphql-tag';

export const adminApiExtensions = gql`
    type DashboardMetricSummary {
        type: DashboardMetricType!
        title: String!
        entries: [DashboardMetricSummaryEntry!]!
    }
    enum DashboardMetricType {
        OrderCount
        OrderTotal
        AverageOrderValue
    }
    type DashboardMetricSummaryEntry {
        label: String!
        value: Float!
    }
    input DashboardMetricSummaryInput {
        types: [DashboardMetricType!]!
        refresh: Boolean
        startDate: DateTime!
        endDate: DateTime!
    }
    extend type Query {
        """
        Get metrics for the given date range and metric types.
        """
        dashboardMetricSummary(input: DashboardMetricSummaryInput): [DashboardMetricSummary!]!
    }
`;
