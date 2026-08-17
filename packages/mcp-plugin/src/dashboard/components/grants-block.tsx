import { Trans, useLingui } from '@lingui/react/macro';
import {
    api,
    Badge,
    Button,
    type ColumnFiltersState,
    ConfirmationDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
    PaginatedListDataTable,
    type SortingState,
    toast,
    useMutation,
    useUserSettings,
} from '@vendure/dashboard';
import { BanIcon, EllipsisIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { mcpOauthGrantsQuery, revokeMcpOauthGrantDocument } from '../mcp.graphql';

const tableSettingsKey = 'mcp-grants-table';

/** Shows the status value the server sent: "active", "expired" or "revoked". */
function StatusBadge({ status }: { status: string }) {
    if (status === 'revoked') {
        return (
            <Badge variant="destructive">
                <Trans>Revoked</Trans>
            </Badge>
        );
    }
    if (status === 'expired') {
        return (
            <Badge variant="secondary">
                <Trans>Expired</Trans>
            </Badge>
        );
    }
    return (
        <Badge variant="default">
            <Trans>Active</Trans>
        </Badge>
    );
}

/**
 * Lists every OAuth grant, including the revoked and expired ones the plugin keeps for
 * auditing; the Status column says which a row is. An operator can revoke a grant that
 * is still active: a dialog confirms it, then the panel calls the `revokeMcpOauthGrant`
 * mutation.
 */
export function GrantsBlock() {
    const { t } = useLingui();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'lastActivityAt', desc: true }]);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);
    const { settings, setTableSettings } = useUserSettings();
    const columnVisibility = settings.tableSettings?.[tableSettingsKey]?.columnVisibility ?? {
        id: false,
        createdAt: false,
        updatedAt: false,
        actorId: false,
        channelId: false,
        revokedAt: false,
    };
    const refreshTable = useRef<() => void>(() => {
        /* the table replaces this when it mounts */
    });

    const revoke = useMutation({
        mutationFn: (vars: { id: string }) => api.mutate(revokeMcpOauthGrantDocument, vars),
        onSuccess: result => {
            if (result.revokeMcpOauthGrant) {
                toast.success(t`Grant revoked`);
            } else {
                toast.error(t`The grant could not be revoked; it may have already been removed`);
            }
            refreshTable.current();
        },
        onError: () => {
            toast.error(t`Could not revoke grant`);
        },
    });

    return (
        <PaginatedListDataTable
            listQuery={mcpOauthGrantsQuery}
            registerRefresher={refresher => {
                refreshTable.current = refresher;
            }}
            page={page}
            itemsPerPage={pageSize}
            sorting={sorting}
            columnFilters={filters}
            onPageChange={(_table, newPage, newPageSize) => {
                setPage(newPage);
                setPageSize(newPageSize);
            }}
            onSortChange={(_table, newSorting) => setSorting(newSorting)}
            onFilterChange={(_table, newFilters) => setFilters(newFilters)}
            onColumnVisibilityChange={(_table, newVisibility) =>
                setTableSettings(tableSettingsKey, 'columnVisibility', newVisibility)
            }
            includeSelectionColumn={false}
            customizeColumns={{
                oauthClientName: {
                    header: () => <Trans>Client</Trans>,
                    cell: ({ row }) => (
                        <span className="font-medium">{row.original.oauthClientName ?? '—'}</span>
                    ),
                },
                actorType: {
                    header: () => <Trans>Actor type</Trans>,
                    cell: ({ row }) =>
                        row.original.actorType ? (
                            <Badge variant="outline">{row.original.actorType}</Badge>
                        ) : (
                            '—'
                        ),
                },
                lastActivityAt: { header: () => <Trans>Last activity</Trans> },
                expiresAt: { header: () => <Trans>Expires</Trans> },
                status: {
                    header: () => <Trans>Status</Trans>,
                    cell: ({ row }) => <StatusBadge status={row.original.status} />,
                },
            }}
            facetedFilters={{
                status: {
                    title: t`Status`,
                    options: [
                        { label: t`Active`, value: 'active' },
                        { label: t`Expired`, value: 'expired' },
                        { label: t`Revoked`, value: 'revoked' },
                    ],
                },
            }}
            additionalColumns={{
                actions: {
                    header: () => <Trans>Actions</Trans>,
                    meta: { dependencies: ['id', 'revokedAt'] },
                    cell: ({ row }) =>
                        row.original.revokedAt != null ? null : (
                            <DropdownMenu>
                                <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                                    <EllipsisIcon />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent className="min-w-56">
                                    <DropdownMenuGroup>
                                        <ConfirmationDialog
                                            title={t`Revoke grant`}
                                            description={t`This immediately revokes the client's access. The client will need to authorize again to reconnect.`}
                                            confirmText={t`Revoke`}
                                            onConfirm={() => revoke.mutate({ id: row.original.id })}
                                        >
                                            <DropdownMenuItem closeOnClick={false}>
                                                <div className="flex items-center gap-2">
                                                    <BanIcon className="w-4 h-4" />
                                                    <Trans>Revoke</Trans>
                                                </div>
                                            </DropdownMenuItem>
                                        </ConfirmationDialog>
                                    </DropdownMenuGroup>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ),
                },
            }}
            defaultColumnOrder={[
                'oauthClientName',
                'actorType',
                'status',
                'lastActivityAt',
                'expiresAt',
                'actions',
            ]}
            defaultVisibility={columnVisibility}
        />
    );
}
