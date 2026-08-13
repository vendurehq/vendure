import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import {
    CustomerCell,
    OrderMoneyCell,
    OrderStateCell,
} from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ErrorState } from '@/vdb/components/ui/state-views.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { INSIGHTS_WIDGET_QUERY_KEY } from '@/vdb/hooks/use-insights-refresh.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { useWidgetFilters } from '@/vdb/hooks/use-widget-filters.js';
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { SortingState } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { DashboardBaseWidget } from '../base-widget.js';
import { latestOrdersQuery } from './latest-orders-widget.graphql.js';

export const WIDGET_ID = 'latest-orders-widget';

export function LatestOrdersWidget() {
    const { t } = useLingui();
    const { formatRelativeDate } = useLocalFormat();
    const { dateRange } = useWidgetFilters();
    const { setTableSettings, settings } = useUserSettings();
    const tableSettings = settings.tableSettings?.[WIDGET_ID];

    const [sorting, setSorting] = useState<SortingState>([
        {
            id: 'orderPlacedAt',
            desc: true,
        },
    ]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(tableSettings?.pageSize ?? 10);

    // Update page size if user settings change
    useEffect(() => {
        if (tableSettings?.pageSize !== undefined) {
            setPageSize(tableSettings.pageSize);
        }
    }, [tableSettings?.pageSize]);

    const defaultVisibility = {
        code: true,
        total: true,
        orderPlacedAt: true,
    };

    const columnVisibility = tableSettings?.columnVisibility ?? defaultVisibility;

    return (
        <DashboardBaseWidget id={WIDGET_ID} title={t`Latest Orders`} description={t`Your latest orders`}>
            {/* The plain frame resolves its band and edge-cell spacing against the
                host card's --card-px, so the CardContent padding around the widget
                body must be cancelled for the bands to run edge to edge. */}
            <div className="-mx-(--card-px)">
                <PaginatedListDataTable
                    frame="plain"
                    page={page}
                    transformVariables={variables => ({
                        ...variables,
                        options: {
                            ...variables.options,
                            filter: {
                                active: {
                                    eq: false,
                                },
                                state: {
                                    notIn: ['Cancelled', 'Draft'],
                                },
                                orderPlacedAt: {
                                    between: {
                                        start: dateRange.from.toISOString(),
                                        end: dateRange.to.toISOString(),
                                    },
                                },
                                ...(variables.options?.filter ?? {}),
                            },
                        },
                    })}
                    // transformVariables output is not part of the query key, so the date range
                    // must be appended for range changes to refetch. INSIGHTS_WIDGET_QUERY_KEY is
                    // prepended so a page-level refresh, which invalidates that prefix, refetches this too.
                    transformQueryKey={queryKey => [
                        INSIGHTS_WIDGET_QUERY_KEY,
                        ...queryKey,
                        dateRange.from.toISOString(),
                        dateRange.to.toISOString(),
                    ]}
                    customizeColumns={{
                        code: {
                            header: t`Code`,
                            cell: ({ row }) => {
                                return (
                                    <Button
                                        variant="ghost"
                                        render={<Link to={`/orders/${row.original.id}`} />}
                                    >
                                        {row.original.code}
                                    </Button>
                                );
                            },
                        },
                        orderPlacedAt: {
                            header: t`Placed At`,
                            cell: ({ row }) => {
                                return (
                                    <span className="capitalize">
                                        {formatRelativeDate(row.original.orderPlacedAt ?? new Date())}
                                    </span>
                                );
                            },
                        },
                        total: {
                            meta: {
                                dependencies: ['currencyCode'],
                            },
                            header: t`Total`,
                            cell: OrderMoneyCell,
                        },
                        totalWithTax: {
                            meta: { dependencies: ['currencyCode'] },
                            cell: OrderMoneyCell,
                        },
                        state: { cell: OrderStateCell },
                        customer: { cell: CustomerCell },
                    }}
                    itemsPerPage={pageSize}
                    sorting={sorting}
                    listQuery={latestOrdersQuery}
                    defaultVisibility={columnVisibility}
                    errorState={({ retry }) => (
                        <ErrorState
                            title={t`Could not load orders`}
                            description={t`There was a problem loading your latest orders.`}
                            onRetry={retry}
                        />
                    )}
                    onPageChange={(_, page, newPageSize) => {
                        setPage(page);
                        setPageSize(newPageSize);
                        setTableSettings(WIDGET_ID, 'pageSize', newPageSize);
                    }}
                    onSortChange={(_, sorting) => {
                        setSorting(sorting);
                    }}
                    onColumnVisibilityChange={(_, columnVisibility) => {
                        setTableSettings(WIDGET_ID, 'columnVisibility', columnVisibility);
                    }}
                />
            </div>
        </DashboardBaseWidget>
    );
}
