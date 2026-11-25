import { AnimatedCurrency, AnimatedNumber } from '@/vdb/components/shared/animated-number.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { ErrorState } from '@/vdb/components/ui/state-views.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { differenceInDays, subDays } from 'date-fns';
import { type ReactNode, useMemo } from 'react';
import { DashboardBaseWidget } from '../base-widget.js';
import { INSIGHTS_WIDGET_QUERY_KEY } from '@/vdb/hooks/use-insights-refresh.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { orderSummaryQuery } from './order-summary-widget.graphql.js';

const WIDGET_ID = 'orders-summary-widget';
const ORDER_COUNT_METRIC = 'OrderCount';
const ORDER_TOTAL_METRIC = 'OrderTotal';

interface PercentageChangeProps {
    value: number;
}

function getMetricTotal(
    data: ResultOf<typeof orderSummaryQuery> | undefined,
    type: typeof ORDER_COUNT_METRIC | typeof ORDER_TOTAL_METRIC,
): number {
    const entries = data?.dashboardMetricSummary.find(metric => metric.type === type)?.entries;
    return entries?.reduce((total, entry) => total + entry.value, 0) ?? 0;
}

function PercentageChange({ value }: Readonly<PercentageChangeProps>) {
    const isZero = value === 0;
    const isPositive = value > 0;
    const colorClass = isZero ? 'text-muted-foreground' : isPositive ? 'text-success' : 'text-destructive';
    const arrow = isZero ? null : isPositive ? '↑' : '↓';

    return (
        <p className={`text-sm ${colorClass}`}>
            {arrow} <AnimatedNumber value={Math.abs(value)} />%
        </p>
    );
}

export function OrdersSummaryWidget() {
    const { t } = useLingui();
    const { dateRange } = useWidgetFilters();

    const variables = useMemo(() => {
        const rangeLength = differenceInDays(dateRange.to, dateRange.from) + 1;
        // For the previous period, we go back by the same range length
        const previousStart = subDays(dateRange.from, rangeLength);
        const previousEnd = subDays(dateRange.to, rangeLength);

        return {
            start: dateRange.from.toISOString(),
            end: dateRange.to.toISOString(),
            previousStart: previousStart.toISOString(),
            previousEnd: previousEnd.toISOString(),
        };
    }, [dateRange]);

    const current = useQuery({
        queryKey: [INSIGHTS_WIDGET_QUERY_KEY, 'orders-summary', dateRange],
        queryFn: () =>
            api.query(orderSummaryQuery, {
                start: variables.start,
                end: variables.end,
            }),
    });

    const previous = useQuery({
        queryKey: [INSIGHTS_WIDGET_QUERY_KEY, 'orders-summary', 'previous', dateRange],
        queryFn: () =>
            api.query(orderSummaryQuery, {
                start: variables.previousStart,
                end: variables.previousEnd,
            }),
    });

    const calculatePercentChange = (currentValue: number, previousValue: number) => {
        if (previousValue === 0) return 0;
        return ((currentValue - previousValue) / previousValue) * 100;
    };

    // The figures show once both periods have loaded, so each percentage is right the first time
    // it shows. They mount with their final values, so they do not count up from zero.
    const isPending = current.isPending || previous.isPending;
    const isError = current.isError || previous.isError;

    const currentTotalOrders = getMetricTotal(current.data, ORDER_COUNT_METRIC);
    const previousTotalOrders = getMetricTotal(previous.data, ORDER_COUNT_METRIC);
    const currentRevenue = getMetricTotal(current.data, ORDER_TOTAL_METRIC);
    const previousRevenue = getMetricTotal(previous.data, ORDER_TOTAL_METRIC);

    const orderChange = calculatePercentChange(currentTotalOrders, previousTotalOrders);
    const revenueChange = calculatePercentChange(currentRevenue, previousRevenue);

    return (
        <DashboardBaseWidget
            id={WIDGET_ID}
            title={t`Orders Summary`}
            description={t`Your orders summary`}
        >
            {isError && !isPending ? (
                <div className="flex h-full w-full items-center justify-center">
                    <ErrorState
                        className="border-0"
                        title={<Trans>We couldn't load the orders summary</Trans>}
                        onRetry={() => {
                            if (current.isError) void current.refetch();
                            if (previous.isError) void previous.refetch();
                        }}
                        retryLabel={t`Try again`}
                    />
                </div>
            ) : (
                <div className="@container h-full">
                    {isPending && (
                        <span className="sr-only" role="status">
                            <Trans>Loading…</Trans>
                        </span>
                    )}
                    <div className="flex flex-col h-full @md:flex-row gap-8 items-center justify-center @md:justify-evenly text-center tabular-nums">
                        <SummaryFigure
                            label={<Trans>Total Orders</Trans>}
                            isPending={isPending}
                            skeletonWidth="w-12"
                            value={
                                <AnimatedNumber
                                    animationConfig={{ mass: 0.01, stiffness: 90, damping: 3 }}
                                    value={currentTotalOrders}
                                />
                            }
                            change={orderChange}
                        />
                        <SummaryFigure
                            label={<Trans>Total Revenue</Trans>}
                            isPending={isPending}
                            skeletonWidth="w-40"
                            value={
                                <AnimatedCurrency
                                    animationConfig={{ mass: 0.01, stiffness: 90, damping: 3 }}
                                    value={currentRevenue}
                                />
                            }
                            change={revenueChange}
                        />
                    </div>
                </div>
            )}
        </DashboardBaseWidget>
    );
}

/**
 * One figure of the summary: its label, the value and the change against the previous period.
 * While pending, the value and the change are skeletons in their own line heights.
 */
function SummaryFigure({
    label,
    isPending,
    skeletonWidth,
    value,
    change,
}: Readonly<{
    label: ReactNode;
    isPending: boolean;
    skeletonWidth: string;
    value: ReactNode;
    change: number;
}>) {
    return (
        <div className="flex flex-col items-center lg:gap-2">
            <p className="lg:text-lg text-muted-foreground">{label}</p>
            {isPending ? (
                <>
                    <div className="flex h-7 items-center @md:h-9" aria-hidden="true">
                        <Skeleton className={`h-6 @md:h-8 ${skeletonWidth}`} />
                    </div>
                    <div className="flex h-5 items-center" aria-hidden="true">
                        <Skeleton className="h-4 w-12" />
                    </div>
                </>
            ) : (
                <>
                    <p className="text-xl @md:text-3xl font-semibold">{value}</p>
                    <PercentageChange value={change} />
                </>
            )}
        </div>
    );
}
