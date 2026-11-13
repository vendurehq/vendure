import { Tabs, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { EmptyState, ErrorState, LoadingState } from '@/vdb/components/ui/state-views.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { INSIGHTS_WIDGET_QUERY_KEY } from '@/vdb/hooks/use-insights-refresh.js';
import { useWidgetConfig } from '@/vdb/hooks/use-widget-config.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { useMemo } from 'react';
import { DashboardBaseWidget } from '../base-widget.js';
import { topProductsOrdersQuery } from './top-products-widget.graphql.js';

const WIDGET_ID = 'top-products-widget';
// Only the most recent ORDER_SAMPLE_SIZE orders are aggregated, so on high-volume stores
// products that only sold earlier in the range may be missed.
const ORDER_SAMPLE_SIZE = 100;
const TOP_N = 8;

type TopProductsMetric = 'quantity' | 'revenue';

interface TopProductsWidgetConfig extends Record<string, unknown> {
    metric: TopProductsMetric;
}

interface AggregatedProduct {
    variantId: string;
    name: string;
    quantity: number;
    revenue: number;
}

export function TopProductsWidget() {
    const { t } = useLingui();
    const { formatCurrency, formatNumber } = useLocalFormat();
    const { activeChannel } = useChannel();
    const { dateRange } = useWidgetFilters();
    const [config, setConfig] = useWidgetConfig<TopProductsWidgetConfig>();
    const metric = config.metric;

    // Revenue is only meaningful within a single currency, so orders are aggregated exclusively
    // over the active channel's default currency; other-currency orders are excluded entirely.
    const currencyCode = activeChannel?.defaultCurrencyCode ?? 'USD';

    const { data, isPending, isError, refetch } = useQuery({
        queryKey: [INSIGHTS_WIDGET_QUERY_KEY, 'top-products-widget', dateRange, currencyCode],
        queryFn: () =>
            api.query(topProductsOrdersQuery, {
                options: {
                    take: ORDER_SAMPLE_SIZE,
                    filter: {
                        active: { eq: false },
                        state: { notIn: ['Cancelled', 'Draft'] },
                        currencyCode: { eq: currencyCode },
                        orderPlacedAt: {
                            between: {
                                start: dateRange.from.toISOString(),
                                end: dateRange.to.toISOString(),
                            },
                        },
                    },
                    sort: { orderPlacedAt: 'DESC' },
                },
            }),
    });

    const topProducts = useMemo<AggregatedProduct[]>(() => {
        const byVariant = new Map<string, AggregatedProduct>();
        for (const order of data?.orders.items ?? []) {
            for (const line of order.lines) {
                const variantId = line.productVariant.id;
                const existing = byVariant.get(variantId) ?? {
                    variantId,
                    name: line.productVariant.name,
                    quantity: 0,
                    revenue: 0,
                };
                existing.quantity += line.quantity;
                existing.revenue += line.linePriceWithTax;
                byVariant.set(variantId, existing);
            }
        }
        return Array.from(byVariant.values())
            .sort((a, b) => (metric === 'revenue' ? b.revenue - a.revenue : b.quantity - a.quantity))
            .slice(0, TOP_N);
    }, [data, metric]);

    return (
        <DashboardBaseWidget
            id={WIDGET_ID}
            title={t`Top Products`}
            description={t`Best sellers from the most recent ${ORDER_SAMPLE_SIZE} orders in ${currencyCode} for the selected period`}
            actions={
                <Tabs
                    value={metric}
                    onValueChange={value => setConfig({ metric: value as TopProductsMetric })}
                >
                    <TabsList>
                        <TabsTrigger value="quantity">
                            <Trans>Quantity</Trans>
                        </TabsTrigger>
                        <TabsTrigger value="revenue">
                            <Trans>Revenue</Trans>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            }
        >
            {isPending ? (
                <div className="flex h-full w-full items-center justify-center">
                    <LoadingState variant="spinner" label={<Trans>Loading top products…</Trans>} />
                </div>
            ) : isError ? (
                <div className="flex h-full w-full items-center justify-center">
                    <ErrorState
                        className="border-0"
                        title={<Trans>We couldn't load the top products</Trans>}
                        onRetry={() => refetch()}
                        retryLabel={t`Try again`}
                    />
                </div>
            ) : topProducts.length ? (
                <ol className="flex flex-col gap-1 tabular-nums">
                    {topProducts.map((product, index) => (
                        <li key={product.variantId}>
                            <Link
                                to="/product-variants/$id"
                                params={{ id: product.variantId }}
                                className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
                            >
                                <span className="w-5 text-right text-sm text-muted-foreground">
                                    {index + 1}
                                </span>
                                <span className="flex-1 truncate text-sm font-medium">{product.name}</span>
                                <span className="text-sm text-muted-foreground">
                                    {metric === 'revenue'
                                        ? formatCurrency(product.revenue, currencyCode)
                                        : formatNumber(product.quantity)}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ol>
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <EmptyState
                        className="border-0"
                        illustration={null}
                        icon={<Package />}
                        title={<Trans>No sales for this period</Trans>}
                        description={<Trans>Try selecting a different date range.</Trans>}
                    />
                </div>
            )}
        </DashboardBaseWidget>
    );
}
