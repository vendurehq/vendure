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
    type ResultOf,
    type SortingState,
    Switch,
    toast,
    useMutation,
} from '@vendure/dashboard';
import { BanIcon, EllipsisIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { mcpOauthGrantsQuery, revokeMcpOauthGrantDocument } from '../mcp.graphql';

/** One row of the grant list, as the Admin API returns it. */
type Grant = ResultOf<typeof mcpOauthGrantsQuery>['mcpOauthGrants']['items'][number];

type GrantStatus = 'active' | 'revoked' | 'expired';

function grantStatus(grant: Grant): GrantStatus {
    if (grant.revokedAt != null) {
        return 'revoked';
    }
    if (new Date(grant.expiresAt).getTime() < Date.now()) {
        return 'expired';
    }
    return 'active';
}

function StatusBadge({ status }: { status: GrantStatus }) {
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
 * Lists OAuth grants and lets an operator revoke one. A dialog confirms the revocation,
 * then the panel calls the `revokeMcpOauthGrant` mutation. The list shows active grants
 * by default; the "Show inactive" toggle adds revoked and expired grants, which the
 * plugin keeps for auditing.
 */
export function GrantsBlock() {
    const { t } = useLingui();
    const [includeInactive, setIncludeInactive] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'lastActivityAt', desc: true }]);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);
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
        <div className="space-y-3">
            <div className="flex items-center gap-2">
                <Switch
                    id="mcp-grants-show-inactive"
                    checked={includeInactive}
                    onCheckedChange={checked => {
                        setIncludeInactive(checked);
                        setPage(1);
                    }}
                />
                <label htmlFor="mcp-grants-show-inactive" className="text-sm cursor-pointer">
                    <Trans>Show inactive</Trans>
                </label>
            </div>
            <PaginatedListDataTable
                listQuery={mcpOauthGrantsQuery}
                // The table only knows how to send `options`, so add the argument that controls
                // whether the list includes revoked and expired grants.
                transformVariables={variables => ({ ...variables, includeInactive })}
                // That argument is not part of the table's own cache key, so add it; without
                // this, flipping the switch would not refetch.
                transformQueryKey={key => [...key, includeInactive]}
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
                }}
                additionalColumns={{
                    status: {
                        header: () => <Trans>Status</Trans>,
                        // The status cell reads `revokedAt` and `expiresAt`, so the query must
                        // fetch both even when this column is hidden.
                        meta: { dependencies: ['revokedAt', 'expiresAt'] },
                        cell: ({ row }) => <StatusBadge status={grantStatus(row.original)} />,
                    },
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
                defaultVisibility={{
                    id: false,
                    createdAt: false,
                    updatedAt: false,
                    actorId: false,
                    channelId: false,
                    revokedAt: false,
                }}
            />
        </div>
    );
}
