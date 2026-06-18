import { Money } from '@/vdb/components/data-display/money.js';
import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { getTypeForState, stateTypeToBadgeVariant } from '@/vdb/utils/state-type.js';
import { Link } from '@tanstack/react-router';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { useState } from 'react';
import { customerOrderListDocument } from '../customers.graphql.js';

interface CustomerOrderTableProps {
    customerId: string;
}

export function CustomerOrderTable({ customerId }: Readonly<CustomerOrderTableProps>) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'orderPlacedAt', desc: true }]);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);

    return (
        <PaginatedListDataTable
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
                    header: 'Total',
                    cell: ({ cell, row }) => {
                        const value = cell.getValue();
                        const currencyCode = row.original.currencyCode;
                        return <Money value={value} currency={currencyCode} />;
                    },
                },
                totalWithTax: {
                    header: 'Total with Tax',
                    cell: ({ cell, row }) => {
                        const value = cell.getValue();
                        const currencyCode = row.original.currencyCode;
                        return <Money value={value} currency={currencyCode} />;
                    },
                },
                state: {
                    header: 'State',
                    cell: ({ cell }) => {
                        const value = cell.getValue() as string;
                        return <Badge variant={stateTypeToBadgeVariant(getTypeForState(value))}>{value}</Badge>;
                    },
                },
                code: {
                    header: 'Code',
                    cell: ({ cell, row }) => {
                        const value = cell.getValue() as string;
                        const id = row.original.id;
                        return (
                            <Button render={<Link to={`/orders/${id}`} />} variant="ghost">
                                {value}
                            </Button>
                        );
                    },
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
