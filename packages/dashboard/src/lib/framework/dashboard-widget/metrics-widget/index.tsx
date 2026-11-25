import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { EmptyState, ErrorState } from '@/vdb/components/ui/state-views.js';
import { Tabs, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { INSIGHTS_WIDGET_QUERY_KEY } from '@/vdb/hooks/use-insights-refresh.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useWidgetConfig } from '@/vdb/hooks/use-widget-config.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { ChartColumn } from 'lucide-react';
import { useMemo } from 'react';
import { DashboardBaseWidget } from '../base-widget.js';
import { ChartSkeleton } from '../widget-skeletons.js';
import { MetricsChart } from './chart.js';
import { orderChartDataQuery } from './metrics-widget.graphql.js';

enum DATA_TYPES {
    OrderCount = 'OrderCount',
    OrderTotal = 'OrderTotal',
    AverageOrderValue = 'AverageOrderValue',
}

interface MetricsWidgetConfig extends Record<string, unknown> {
    dataType: DATA_TYPES;
}

export function MetricsWidget() {
    const { t } = useLingui();
    const { formatDate, formatCurrency } = useLocalFormat();
    const { activeChannel } = useChannel();
    const { dateRange } = useWidgetFilters();
    const [config, setConfig] = useWidgetConfig<MetricsWidgetConfig>();
    const dataType = config.dataType;

    const dataTypeLabels: Record<DATA_TYPES, string> = {
        [DATA_TYPES.OrderCount]: t`Order Count`,
        [DATA_TYPES.OrderTotal]: t`Order Total`,
        [DATA_TYPES.AverageOrderValue]: t`Average Order Value`,
    };
    const dataTypeOptions = Object.values(DATA_TYPES).map(value => ({ value, label: dataTypeLabels[value] }));
    const dataTypeLabel = dataTypeLabels[dataType];

    const { data, refetch, isPending, isError } = useQuery({
        queryKey: [INSIGHTS_WIDGET_QUERY_KEY, 'dashboard-order-metrics', dataType, dateRange],
        queryFn: () => {
            return api.query(orderChartDataQuery, {
                types: [dataType],
                startDate: dateRange.from.toISOString(),
                endDate: dateRange.to.toISOString(),
            });
        },
    });

    const chartData = useMemo(() => {
        const entry = data?.dashboardMetricSummary.at(0);
        if (!entry) {
            return undefined;
        }

        const { type, entries } = entry;

        const values = entries.map(({ label, value }: { label: string; value: number }) => ({
            name: formatDate(label, { month: 'short', day: 'numeric' }),
            sales: value,
        }));

        return {
            values,
            type,
        };
    }, [data, formatDate]);

    return (
        <DashboardBaseWidget
            id="metrics-widget"
            title={t`Metrics`}
            description={t`Order metrics`}
            actions={
                <>
                    {/* A narrow card has no room for three tabs, so it offers the same choice as a Select. */}
                    <Tabs
                        value={dataType}
                        onValueChange={value => setConfig({ dataType: value as DATA_TYPES })}
                        className="@max-md/card-header:hidden"
                    >
                        <TabsList>
                            {dataTypeOptions.map(option => (
                                <TabsTrigger key={option.value} value={option.value}>
                                    {option.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                    <Select
                        items={dataTypeLabels}
                        value={dataType}
                        onValueChange={value => setConfig({ dataType: value as DATA_TYPES })}
                    >
                        <SelectTrigger className="hidden @max-md/card-header:flex" aria-label={t`Metrics`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {dataTypeOptions.map(option => (
                                <SelectItem key={option.value} value={option.value}>
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </>
            }
        >
            {isPending ? (
                <ChartSkeleton />
            ) : isError ? (
                <div className="flex h-full w-full items-center justify-center">
                    <ErrorState
                        className="border-0"
                        title={<Trans>We couldn't load these metrics</Trans>}
                        onRetry={() => refetch()}
                        retryLabel={t`Try again`}
                    />
                </div>
            ) : chartData ? (
                <MetricsChart
                    formatValue={value => {
                        if (dataType === DATA_TYPES.OrderCount) {
                            return value;
                        }

                        return formatCurrency(value, activeChannel?.defaultCurrencyCode ?? 'USD', 0);
                    }}
                    chartData={chartData.values}
                    dataLabel={dataTypeLabel}
                />
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <EmptyState
                        className="border-0"
                        illustration={null}
                        icon={<ChartColumn />}
                        title={<Trans>No metrics for this period</Trans>}
                        description={<Trans>Try selecting a different date range.</Trans>}
                    />
                </div>
            )}
        </DashboardBaseWidget>
    );
}
