import { Trans, useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    Button,
    type ColumnDef,
    ConfirmationDialog,
    DataTable,
    DateTime,
    toast,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { TriangleAlert } from 'lucide-react';

import { MCP_OAUTH_GRANTS_QUERY, McpOauthGrantInfo, REVOKE_MCP_OAUTH_GRANT } from '../queries';

/**
 * Lists active OAuth grants and lets an operator revoke one. Revoking is
 * confirmed via a dialog and calls the `revokeMcpOauthGrant` mutation.
 */
export function GrantsBlock() {
    const { t } = useLingui();
    const qc = useQueryClient();

    const { data, isLoading, error } = useQuery({
        queryKey: ['mcp-oauth-grants'],
        queryFn: () => api.query<{ mcpOauthGrants: McpOauthGrantInfo[] }>(MCP_OAUTH_GRANTS_QUERY),
    });

    const revoke = useMutation({
        mutationFn: (vars: { id: string }) =>
            api.mutate(REVOKE_MCP_OAUTH_GRANT, vars) as Promise<{ revokeMcpOauthGrant: boolean }>,
        onSuccess: result => {
            if (result.revokeMcpOauthGrant) {
                toast.success(t`Grant revoked`);
            } else {
                toast.error(t`The grant could not be revoked; it may have already been removed`);
            }
            void qc.invalidateQueries({ queryKey: ['mcp-oauth-grants'] });
        },
        onError: () => {
            toast.error(t`Could not revoke grant`);
        },
    });

    const grants = data?.mcpOauthGrants ?? [];

    if (error) {
        return (
            <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                    <Trans>Error loading grants: {error.message}</Trans>
                </AlertDescription>
            </Alert>
        );
    }

    const columns: Array<ColumnDef<McpOauthGrantInfo>> = [
        {
            accessorKey: 'oauthClientName',
            header: () => <Trans>Client</Trans>,
            cell: ({ row }) => <span className="font-medium">{row.original.oauthClientName ?? '—'}</span>,
        },
        {
            accessorKey: 'actorType',
            header: () => <Trans>Actor type</Trans>,
            cell: ({ row }) =>
                row.original.actorType ? <Badge variant="outline">{row.original.actorType}</Badge> : '—',
        },
        {
            accessorKey: 'lastActivityAt',
            header: () => <Trans>Last activity</Trans>,
            cell: ({ row }) => <DateTime value={row.original.lastActivityAt} />,
        },
        {
            accessorKey: 'expiresAt',
            header: () => <Trans>Expires</Trans>,
            cell: ({ row }) => <DateTime value={row.original.expiresAt} />,
        },
        {
            id: 'actions',
            header: () => <Trans>Actions</Trans>,
            cell: ({ row }) => (
                <ConfirmationDialog
                    title={t`Revoke grant`}
                    description={t`This immediately revokes the client's access. The client will need to authorize again to reconnect.`}
                    onConfirm={() => revoke.mutate({ id: row.original.id })}
                >
                    <Button variant="destructive" size="sm">
                        <Trans>Revoke</Trans>
                    </Button>
                </ConfirmationDialog>
            ),
        },
    ];

    return (
        <DataTable
            columns={columns}
            data={grants}
            totalItems={grants.length}
            isLoading={isLoading}
            page={1}
            itemsPerPage={100}
            disableViewOptions
        />
    );
}
