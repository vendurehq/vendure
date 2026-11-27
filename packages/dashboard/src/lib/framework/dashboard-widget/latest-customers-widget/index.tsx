import { EmptyState, ErrorState } from '@/vdb/components/ui/state-views.js';
import { api } from '@/vdb/graphql/api.js';
import { INSIGHTS_WIDGET_QUERY_KEY } from '@/vdb/hooks/use-insights-refresh.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
    ListRow,
    ListRowChevron,
    ListRowContent,
    ListRowLink,
    ListRowMeta,
    ListRowTrailing,
} from '@vendure-io/ui/components/molecules/list-row';
import { Users } from 'lucide-react';
import { DashboardBaseWidget } from '../base-widget.js';
import { ListRowsSkeleton } from '../widget-skeletons.js';
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
                <ListRowsSkeleton rows={MAX_ITEMS} meta trailingWidth="w-16" />
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
                <div role="list" className="-ms-(--card-ps) -me-(--card-px)">
                    {customers.map(customer => (
                        <ListRow key={customer.id} role="listitem">
                            <ListRowContent>
                                <ListRowLink
                                    render={<Link to="/customers/$id" params={{ id: customer.id }} />}
                                >
                                    {customer.firstName} {customer.lastName}
                                </ListRowLink>
                                <ListRowMeta>{customer.emailAddress}</ListRowMeta>
                            </ListRowContent>
                            <ListRowTrailing className="text-xs capitalize">
                                {formatRelativeDate(customer.createdAt)}
                            </ListRowTrailing>
                            <ListRowChevron />
                        </ListRow>
                    ))}
                </div>
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
