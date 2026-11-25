import { BooleanDisplayBadge } from '@/vdb/components/data-display/boolean.js';
import { IdentifierDisplay } from '@/vdb/components/data-display/identifier.js';
import { DataTable } from '@/vdb/components/data-table/data-table.js';
import { useGeneratedColumns } from '@/vdb/components/data-table/use-generated-columns.js';
import { CountrySelector } from '@/vdb/components/shared/country-selector.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ReactNode, useMemo, useState } from 'react';
import { addCountryToZoneMutation, zoneMembersQuery } from '../zones.graphql.js';
import { removeCountryFromZoneBulkAction } from './zone-bulk-actions.js';

interface ZoneCountriesTableProps {
    zoneId: string;
    canAddCountries?: boolean;
    title?: ReactNode;
}

export function ZoneCountriesTable({
    zoneId,
    canAddCountries = false,
    title,
}: Readonly<ZoneCountriesTableProps>) {
    // No placeholder data: the key names one zone, so another zone's countries
    // must not show while this one loads. `isPending` shows the skeleton on the
    // first load and on a zone switch, not on the refetch after adding a country.
    const { data, refetch, isPending } = useQuery({
        queryKey: ['zone', zoneId],
        queryFn: () => api.query(zoneMembersQuery, { zoneId }),
        placeholderData: undefined,
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
            code: {
                header: () => <Trans>Code</Trans>,
                accessorKey: 'code',
                cell: ({ getValue }) => <IdentifierDisplay value={getValue() as string} />,
            },
            enabled: {
                header: () => <Trans>Status</Trans>,
                accessorKey: 'enabled',
                cell: ({ getValue }) => <BooleanDisplayBadge value={getValue() as boolean} />,
            },
        },
        bulkActions,
        includeActionsColumn: false,
        enableSorting: false,
    });

    return (
        <DataTable
            columns={columns as any}
            data={paginatedItems ?? []}
            isLoading={isPending}
            onPageChange={(table, page, itemsPerPage) => {
                setPage(page);
                setPageSize(itemsPerPage);
            }}
            totalItems={data?.zone?.members?.length ?? 0}
            bulkActions={bulkActions}
            title={title}
            actions={
                canAddCountries ? (
                    <CountrySelector
                        onSelect={country => {
                            addCountryToZone({
                                zoneId,
                                memberIds: [country.id],
                            });
                        }}
                    />
                ) : undefined
            }
        />
    );
}
