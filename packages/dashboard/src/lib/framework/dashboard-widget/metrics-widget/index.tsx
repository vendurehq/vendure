import { Button } from '@/vdb/components/ui/button.js';
import { Tabs, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DashboardBaseWidget } from '../base-widget.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { MetricsChart } from './chart.js';
import { orderChartDataQuery } from './metrics-widget.graphql.js';

enum DATA_TYPES {
    OrderCount = 'OrderCount',
    OrderTotal = 'OrderTotal',
    AverageOrderValue = 'AverageOrderValue',
}

export function MetricsWidget() {
    const { t } = useLingui();
    const { formatDate, formatCurrency } = useLocalFormat();
    const { activeChannel } = useChannel();
    const { dateRange } = useWidgetFilters();
    const [dataType, setDataType] = useState<DATA_TYPES>(DATA_TYPES.OrderTotal);

    const dataTypeLabel = useMemo(() => {
        switch (dataType) {
            case DATA_TYPES.OrderCount:
                return t`Order Count`;
            case DATA_TYPES.OrderTotal:
                return t`Order Total`;
            case DATA_TYPES.AverageOrderValue:
                return t`Average Order Value`;
        }
    }, [dataType, t]);

    const { data, refetch, isRefetching } = useQuery({
        queryKey: ['dashboard-order-metrics', dataType, dateRange],
        queryFn: () => {
            return api.query(orderChartDataQuery, {
                types: [dataType],
                refresh: true,
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
                <div className="flex gap-1">
                    <Tabs defaultValue={dataType} onValueChange={value => setDataType(value as DATA_TYPES)}>
                        <TabsList>
                            <TabsTrigger value={DATA_TYPES.OrderCount}><Trans>Order Count</Trans></TabsTrigger>
                            <TabsTrigger value={DATA_TYPES.OrderTotal}><Trans>Order Total</Trans></TabsTrigger>
                            <TabsTrigger value={DATA_TYPES.AverageOrderValue}>
                                <Trans>Average Order Value</Trans>
                            </TabsTrigger>
                        </TabsList>
                    </Tabs>
                    <Button variant={'ghost'} onClick={() => refetch()}>
                        <RefreshCw className={isRefetching ? 'animate-rotate' : ''} />
                    </Button>
                </div>
            }
        >
            {chartData && (
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
            )}
        </DashboardBaseWidget>
    );
}
