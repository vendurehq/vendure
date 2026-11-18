import { Money } from '@/vdb/components/data-display/money.js';
import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { OrderCodeCell, OrderStateCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { useLingui } from '@lingui/react/macro';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { ReactNode, useState } from 'react';
import { customerOrderListDocument } from '../customers.graphql.js';

interface CustomerOrderTableProps {
    customerId: string;
    title?: ReactNode;
}

export function CustomerOrderTable({ customerId, title }: Readonly<CustomerOrderTableProps>) {
    const { t } = useLingui();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'orderPlacedAt', desc: true }]);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);

    return (
        <PaginatedListDataTable
            title={title}
            listQuery={customerOrderListDocument}
            transformVariables={variables => {
                return {
                    ...variables,
                    customerId,
                };
            }}
            defaultVisibility={{
                id: false,
                createdAt: false,
                updatedAt: false,
                type: false,
                currencyCode: false,
                total: false,
            }}
            customizeColumns={{
                total: {
                    header: () => <div className="text-end">{t`Total`}</div>,
                    cell: ({ cell, row }) => {
                        const value = cell.getValue();
                        const currencyCode = row.original.currencyCode;
                        return (
                            <div className="text-end">
                                <Money value={value} currency={currencyCode} />
                            </div>
                        );
                    },
                },
                totalWithTax: {
                    header: () => <div className="text-end">{t`Total with Tax`}</div>,
                    cell: ({ cell, row }) => {
                        const value = cell.getValue();
                        const currencyCode = row.original.currencyCode;
                        return (
                            <div className="text-end">
                                <Money value={value} currency={currencyCode} />
                            </div>
                        );
                    },
                },
                state: {
                    header: () => t`State`,
                    cell: OrderStateCell,
                },
                code: {
                    header: () => t`Code`,
                    cell: OrderCodeCell,
                },
            }}
            page={page}
            itemsPerPage={pageSize}
            sorting={sorting}
            columnFilters={filters}
            onPageChange={(_, page, perPage) => {
                setPage(page);
                setPageSize(perPage);
            }}
            onSortChange={(_, sorting) => {
                setSorting(sorting);
            }}
            onFilterChange={(_, filters) => {
                setFilters(filters);
            }}
        />
    );
}
