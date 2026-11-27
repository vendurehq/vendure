import { AnimatedCurrency, AnimatedNumber } from '@/vdb/components/shared/animated-number.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { ErrorState } from '@/vdb/components/ui/state-views.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { INSIGHTS_WIDGET_QUERY_KEY } from '@/vdb/hooks/use-insights-refresh.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { differenceInDays, subDays } from 'date-fns';
import { type ReactNode, useMemo } from 'react';
import { DashboardBaseWidget } from '../base-widget.js';
import { orderSummaryComparisonQuery } from './order-summary-widget.graphql.js';

const WIDGET_ID = 'orders-summary-widget';

type PeriodSummary = ResultOf<typeof orderSummaryComparisonQuery>['current'];
type SummaryMetric = PeriodSummary[number]['type'];

function getMetricTotal(period: PeriodSummary, type: SummaryMetric): number {
    const entries = period.find(metric => metric.type === type)?.entries;
    return entries?.reduce((total, entry) => total + entry.value, 0) ?? 0;
}

function calculatePercentChange(current: number, previous: number) {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
}

function PercentageChange({ value }: Readonly<{ value: number }>) {
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

    // One request returns both periods, so each percentage shows once, from both final totals.
    const { data, isPending, isError, refetch } = useQuery({
        queryKey: [INSIGHTS_WIDGET_QUERY_KEY, 'orders-summary', dateRange],
        queryFn: () => api.query(orderSummaryComparisonQuery, variables),
    });

    return (
        <DashboardBaseWidget id={WIDGET_ID} title={t`Orders Summary`} description={t`Your orders summary`}>
            <span className="sr-only" role="status">
                {isPending && <Trans>Loading…</Trans>}
            </span>
            {isPending ? (
                <SummaryLayout>
                    <SummaryFigureSkeleton label={<Trans>Total Orders</Trans>} valueClassName="w-12" />
                    <SummaryFigureSkeleton label={<Trans>Total Revenue</Trans>} valueClassName="w-40" />
                </SummaryLayout>
            ) : isError ? (
                <div className="flex h-full w-full items-center justify-center">
                    <ErrorState
                        className="border-0"
                        title={<Trans>We couldn't load the orders summary</Trans>}
                        onRetry={() => refetch()}
                        retryLabel={t`Try again`}
                    />
                </div>
            ) : (
                <OrdersSummaryFigures current={data.current} previous={data.previous} />
            )}
        </DashboardBaseWidget>
    );
}

function OrdersSummaryFigures({
    current,
    previous,
}: Readonly<{ current: PeriodSummary; previous: PeriodSummary }>) {
    const currentTotalOrders = getMetricTotal(current, 'OrderCount');
    const currentRevenue = getMetricTotal(current, 'OrderTotal');
    const orderChange = calculatePercentChange(currentTotalOrders, getMetricTotal(previous, 'OrderCount'));
    const revenueChange = calculatePercentChange(currentRevenue, getMetricTotal(previous, 'OrderTotal'));

    // The numbers mount with their final values, so the first load does not count up from zero.
    return (
        <SummaryLayout>
            <SummaryFigure label={<Trans>Total Orders</Trans>}>
                <p className={VALUE_TEXT}>
                    <AnimatedNumber
                        animationConfig={{ mass: 0.01, stiffness: 90, damping: 3 }}
                        value={currentTotalOrders}
                    />
                </p>
                <PercentageChange value={orderChange} />
            </SummaryFigure>
            <SummaryFigure label={<Trans>Total Revenue</Trans>}>
                <p className={VALUE_TEXT}>
                    <AnimatedCurrency
                        animationConfig={{ mass: 0.01, stiffness: 90, damping: 3 }}
                        value={currentRevenue}
                    />
                </p>
                <PercentageChange value={revenueChange} />
            </SummaryFigure>
        </SummaryLayout>
    );
}

const VALUE_TEXT = 'text-xl @md:text-3xl font-semibold';

function SummaryLayout({ children }: Readonly<{ children: ReactNode }>) {
    return (
        <div className="@container h-full">
            <div className="flex flex-col h-full @md:flex-row gap-8 items-center justify-center @md:justify-evenly text-center tabular-nums">
                {children}
            </div>
        </div>
    );
}

function SummaryFigure({ label, children }: Readonly<{ label: ReactNode; children: ReactNode }>) {
    return (
        <div className="flex flex-col items-center lg:gap-2">
            <p className="lg:text-lg text-muted-foreground">{label}</p>
            {children}
        </div>
    );
}

/**
 * A figure while it loads. Each skeleton sits on a line with an invisible glyph in the text classes
 * of the value or the percentage, so the figure keeps its height when the numbers arrive.
 */
function SummaryFigureSkeleton({
    label,
    valueClassName,
}: Readonly<{ label: ReactNode; valueClassName: string }>) {
    return (
        <SummaryFigure label={label}>
            <SkeletonLine className={`${VALUE_TEXT} ${valueClassName}`} />
            <SkeletonLine className="text-sm w-12" />
        </SummaryFigure>
    );
}

function SkeletonLine({ className }: Readonly<{ className: string }>) {
    return (
        <div className={`relative ${className}`} aria-hidden="true">
            <span className="invisible">0</span>
            <Skeleton className="absolute inset-x-0 top-1/2 h-[0.8em] -translate-y-1/2" />
        </div>
    );
}
