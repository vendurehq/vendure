export type DashboardMetricSummary = {
    type: DashboardMetricType;
    title: string;
    entries: DashboardMetricSummaryEntry[];
};

export enum DashboardMetricType {
    OrderCount = 'OrderCount',
    OrderTotal = 'OrderTotal',
    AverageOrderValue = 'AverageOrderValue',
}

export type DashboardMetricSummaryEntry = {
    label: string;
    value: number;
};

export interface DashboardMetricSummaryInput {
    types: DashboardMetricType[];
    /**
     * @deprecated Metrics are calculated on every request.
     */
    refresh?: boolean;
    startDate: string;
    endDate: string;
}
