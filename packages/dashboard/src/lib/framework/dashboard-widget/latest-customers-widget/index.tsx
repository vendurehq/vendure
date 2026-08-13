import { EmptyState, ErrorState, LoadingState } from '@/vdb/components/ui/state-views.js';
import { api } from '@/vdb/graphql/api.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { INSIGHTS_WIDGET_QUERY_KEY } from '@/vdb/hooks/use-insights-refresh.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { DashboardBaseWidget } from '../base-widget.js';
import { latestCustomersQuery } from './latest-customers-widget.graphql.js';

const WIDGET_ID = 'latest-customers-widget';
const MAX_ITEMS = 10;

export function LatestCustomersWidget() {
    const { t } = useLingui();
    const { formatRelativeDate } = useLocalFormat();
    const { dateRange } = useWidgetFilters();

    const { data, isPending, isError, refetch } = useQuery({
        queryKey: [INSIGHTS_WIDGET_QUERY_KEY, 'latest-customers-widget', dateRange],
        queryFn: () =>
            api.query(latestCustomersQuery, {
                options: {
                    take: MAX_ITEMS,
                    filter: {
                        createdAt: {
                            between: {
                                start: dateRange.from.toISOString(),
                                end: dateRange.to.toISOString(),
                            },
                        },
                    },
                    sort: { createdAt: 'DESC' },
                },
            }),
    });

    const customers = data?.customers.items ?? [];

    return (
        <DashboardBaseWidget
            id={WIDGET_ID}
            title={t`Latest Customers`}
            description={t`New registrations in the selected period`}
        >
            {isPending ? (
                <div className="flex h-full w-full items-center justify-center">
                    <LoadingState variant="spinner" label={<Trans>Loading customers…</Trans>} />
                </div>
            ) : isError ? (
                <div className="flex h-full w-full items-center justify-center">
                    <ErrorState
                        className="border-0"
                        title={<Trans>We couldn't load the latest customers</Trans>}
                        onRetry={() => refetch()}
                        retryLabel={t`Try again`}
                    />
                </div>
            ) : customers.length ? (
                <ul className="flex flex-col gap-1">
                    {customers.map(customer => (
                        <li key={customer.id}>
                            <Link
                                to="/customers/$id"
                                params={{ id: customer.id }}
                                className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted"
                            >
                                <div className="flex-1 truncate">
                                    <div className="truncate text-sm font-medium">
                                        {customer.firstName} {customer.lastName}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                        {customer.emailAddress}
                                    </div>
                                </div>
                                <span className="shrink-0 text-xs text-muted-foreground capitalize">
                                    {formatRelativeDate(customer.createdAt)}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <EmptyState
                        className="border-0"
                        illustration={null}
                        icon={<Users />}
                        title={<Trans>No new customers for this period</Trans>}
                        description={<Trans>Try selecting a different date range.</Trans>}
                    />
                </div>
            )}
        </DashboardBaseWidget>
    );
}
