import { DataTable } from '@/vdb/components/data-table/data-table.js';
import { useGeneratedColumns } from '@/vdb/components/data-table/use-generated-columns.js';
import { CountrySelector } from '@/vdb/components/shared/country-selector.js';
import { api } from '@/vdb/graphql/api.js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Trans } from '@lingui/react/macro';
import { useMemo, useState } from 'react';
import {
    addCountryToZoneMutation,
    zoneMembersQuery,
} from '../zones.graphql.js';
import { removeCountryFromZoneBulkAction } from './zone-bulk-actions.js';

interface ZoneCountriesTableProps {
    zoneId: string;
    canAddCountries?: boolean;
}

export function ZoneCountriesTable({ zoneId, canAddCountries = false }: Readonly<ZoneCountriesTableProps>) {
    const { data, refetch } = useQuery({
        queryKey: ['zone', zoneId],
        queryFn: () => api.query(zoneMembersQuery, { zoneId }),
    });

    const { mutate: addCountryToZone } = useMutation({
        mutationFn: api.mutate(addCountryToZoneMutation),
        onSuccess: () => {
            refetch();
        },
    });

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    const paginatedItems = useMemo(() => {
        return data?.zone?.members?.slice((page - 1) * pageSize, page * pageSize);
    }, [data, page, pageSize]);

    const bulkActions = useMemo(
        () => [
            {
                component: removeCountryFromZoneBulkAction(zoneId),
                order: 500,
            },
        ],
        [zoneId],
    );

    const { columns } = useGeneratedColumns({
        fields: [],
        additionalColumns: {
            name: {
                header: () => <Trans>Country</Trans>,
                accessorKey: 'name',
            },
            enabled: {
                header: () => <Trans>Enabled</Trans>,
                accessorKey: 'enabled',
            },
            code: {
                header: () => <Trans>Code</Trans>,
                accessorKey: 'code',
            },
        },
        bulkActions,
        includeActionsColumn: false,
        enableSorting: false,
    });

    return (
        <div>
            <DataTable
                columns={columns as any}
                data={paginatedItems ?? []}
                onPageChange={(table, page, itemsPerPage) => {
                    setPage(page);
                    setPageSize(itemsPerPage);
                }}
                totalItems={data?.zone?.members?.length ?? 0}
                bulkActions={bulkActions}
            />
            {canAddCountries && (
                <CountrySelector
                    onSelect={country => {
                        addCountryToZone({
                            zoneId,
                            memberIds: [country.id],
                        });
                    }}
                />
            )}
        </div>
    );
}
