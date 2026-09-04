import { Trans } from '@lingui/react/macro';
import { Badge, PaginatedListDataTable, type ResultOf } from '@vendure/dashboard';

import { mcpToolCallLogsQuery } from '../mcp.graphql';

import { ActorCell } from './actor-cell';
import { EmptyCell } from './empty-cell';
import { useMcpTableState } from './use-mcp-table-state';

type CallLog = ResultOf<typeof mcpToolCallLogsQuery>['mcpToolCallLogs']['items'][number];

function CallStatusBadge({ status }: { status: CallLog['status'] }) {
    const variant = status === 'success' ? 'success' : 'destructive';
    return <Badge variant={variant}>{status}</Badge>;
}

export function ActivityBlock() {
    const tableState = useMcpTableState({
        defaultSorting: [{ id: 'createdAt', desc: true }],
        defaultVisibility: { id: false, pluginSource: false },
    });

    return (
        <PaginatedListDataTable
            listQuery={mcpToolCallLogsQuery}
            {...tableState}
            // No bulk actions on this panel, so no row-selection checkboxes.
            includeSelectionColumn={false}
            customizeColumns={{
                createdAt: { header: () => <Trans>Time</Trans> },
                toolName: {
                    header: () => <Trans>Tool</Trans>,
                    cell: ({ row }) => <span className="font-mono text-sm">{row.original.toolName}</span>,
                },
                actor: {
                    header: () => <Trans>Actor</Trans>,
                    meta: { dependencies: ['actorType', 'actorName', 'customerId'] },
                    cell: ({ row }) => (
                        <ActorCell
                            actorType={row.original.actorType}
                            actorName={row.original.actorName ?? null}
                            customerId={row.original.customerId ?? null}
                        />
                    ),
                },
                actorType: {
                    header: () => <Trans>Actor type</Trans>,
                    cell: ({ row }) => <Badge variant="outline">{row.original.actorType}</Badge>,
                },
                // Fetched only to feed the Actor cell; neither has a database column to sort or filter by.
                actorName: { meta: { disabled: true } },
                customerId: { meta: { disabled: true } },
                status: {
                    header: () => <Trans>Status</Trans>,
                    cell: ({ row }) => <CallStatusBadge status={row.original.status} />,
                },
                durationMs: {
                    header: () => <Trans>Duration</Trans>,
                    cell: ({ row }) =>
                        row.original.durationMs == null ? <EmptyCell /> : `${row.original.durationMs} ms`,
                },
            }}
            // Columns not listed here still show up, just appended after these.
            defaultColumnOrder={[
                'createdAt',
                'toolName',
                'actor',
                'actorType',
                'status',
                'durationMs',
                'pluginSource',
            ]}
        />
    );
}
