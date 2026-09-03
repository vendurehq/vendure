import { Trans, useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    Button,
    ConfirmationDialog,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
    PaginatedListDataTable,
    toast,
    useMutation,
    usePermissions,
    useQuery,
} from '@vendure/dashboard';
import { BanIcon, EllipsisIcon, InfoIcon } from 'lucide-react';
import { useRef } from 'react';

import { mcpOauthGrantsQuery, mcpServerConfigQuery, revokeMcpOauthGrantDocument } from '../mcp.graphql';

import { ActorCell } from './actor-cell';
import { EmptyCell } from './empty-cell';
import { useMcpTableState } from './use-mcp-table-state';

/** Shows the status value the server sent: "active", "expired" or "revoked". */
function GrantStatusBadge({ status }: { status: string }) {
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

export function GrantsBlock() {
    const { t } = useLingui();
    const { hasPermissions } = usePermissions();
    const canUpdate = hasPermissions(['UpdateMcpServer']);
    const tableState = useMcpTableState({
        defaultSorting: [{ id: 'lastActivityAt', desc: true }],
        defaultVisibility: {
            id: false,
            createdAt: false,
            updatedAt: false,
            actorId: false,
            channelId: false,
            revokedAt: false,
        },
    });
    const refreshTable = useRef<() => void>(() => {
        /* the table replaces this when it mounts */
    });

    const { data: configData } = useQuery({
        queryKey: ['mcp-server-config'],
        queryFn: () => api.query(mcpServerConfigQuery),
    });
    const oauthMissing = configData?.mcpServerConfig.oauthConfigured === false;

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
        <div className="space-y-4">
            {oauthMissing ? (
                <Alert>
                    <InfoIcon className="h-4 w-4" />
                    <AlertDescription>
                        <Trans>
                            OAuth is not configured, so no client can be granted access. Add an oauth block to
                            McpPlugin.init to use grants.
                        </Trans>
                    </AlertDescription>
                </Alert>
            ) : null}
            <PaginatedListDataTable
                listQuery={mcpOauthGrantsQuery}
                registerRefresher={refresher => {
                    refreshTable.current = refresher;
                }}
                {...tableState}
                includeSelectionColumn={false}
                customizeColumns={{
                    oauthClientName: {
                        header: () => <Trans>Client</Trans>,
                        cell: ({ row }) =>
                            row.original.oauthClientName ? (
                                <span className="font-medium">{row.original.oauthClientName}</span>
                            ) : (
                                <EmptyCell />
                            ),
                    },
                    actorName: {
                        header: () => <Trans>Granted to</Trans>,
                        meta: { dependencies: ['actorType', 'customerId'] },
                        // The name is looked up per row and has no database column, so the server
                        // rejects any attempt to sort or filter by it.
                        enableSorting: false,
                        enableColumnFilter: false,
                        cell: ({ row }) => (
                            <ActorCell
                                actorType={row.original.actorType ?? null}
                                actorName={row.original.actorName ?? null}
                                customerId={row.original.customerId ?? null}
                            />
                        ),
                    },
                    actorType: {
                        header: () => <Trans>Actor type</Trans>,
                        cell: ({ row }) =>
                            row.original.actorType ? (
                                <Badge variant="outline">{row.original.actorType}</Badge>
                            ) : (
                                <EmptyCell />
                            ),
                    },
                    // Only feeds the "Granted to" cell, which lists it as a dependency so it is still
                    // fetched. It gets no column of its own, since it has no database column to sort
                    // or filter by.
                    customerId: { meta: { disabled: true } },
                    lastActivityAt: { header: () => <Trans>Last activity</Trans> },
                    expiresAt: { header: () => <Trans>Expires</Trans> },
                    status: {
                        header: () => <Trans>Status</Trans>,
                        cell: ({ row }) => <GrantStatusBadge status={row.original.status} />,
                    },
                }}
                additionalColumns={{
                    actions: {
                        header: () => <Trans>Actions</Trans>,
                        meta: { dependencies: ['id', 'revokedAt'] },
                        enableHiding: false,
                        // A revoked grant has nothing left to act on, and a user without the update
                        // permission cannot revoke one. Either way the column still shows a disabled
                        // control so the row doesn't look broken.
                        cell: ({ row }) =>
                            row.original.revokedAt != null || !canUpdate ? (
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled
                                    aria-label={
                                        row.original.revokedAt != null
                                            ? t`No actions available for a revoked grant`
                                            : t`Revoking needs the UpdateMcpServer permission`
                                    }
                                >
                                    <EllipsisIcon />
                                </Button>
                            ) : (
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
                // Every column has to be named here, including the ones hidden by default. The
                // dashboard appends any column left out of this list after the listed ones, which
                // for this table means after "actions" - so an omitted column would show up to the
                // right of the revoke menu once the user enables it. "actions" stays last, and
                // id / createdAt / updatedAt are moved to the front by the dashboard itself.
                defaultColumnOrder={[
                    'oauthClientName',
                    'actorName',
                    'actorType',
                    'status',
                    'lastActivityAt',
                    'expiresAt',
                    'actorId',
                    'channelId',
                    'revokedAt',
                    'actions',
                ]}
            />
        </div>
    );
}
