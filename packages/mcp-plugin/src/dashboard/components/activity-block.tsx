import { Trans } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    type ColumnDef,
    DataTable,
    DateTime,
    useQuery,
} from '@vendure/dashboard';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { MCP_TOOL_CALL_LOGS_QUERY, McpToolCallLog, McpToolCallLogList } from '../queries';

function StatusBadge({ status }: { status: string }) {
    const variant = status === 'success' ? 'success' : status === 'error' ? 'destructive' : 'secondary';
    return <Badge variant={variant}>{status}</Badge>;
}

/**
 * Shows the most recent MCP tool calls, paginated server-side via the
 * `mcpToolCallLogs` list query.
 */
export function ActivityBlock() {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    const { data, isLoading, error } = useQuery({
        queryKey: ['mcp-tool-call-logs', page, pageSize],
        queryFn: () =>
            api.query<{ mcpToolCallLogs: McpToolCallLogList }>(MCP_TOOL_CALL_LOGS_QUERY, {
                options: { skip: (page - 1) * pageSize, take: pageSize },
            }),
    });

    const list = data?.mcpToolCallLogs;

    if (error) {
        return (
            <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                    <Trans>Error loading activity: {error.message}</Trans>
                </AlertDescription>
            </Alert>
        );
    }

    const columns: Array<ColumnDef<McpToolCallLog>> = [
        {
            accessorKey: 'createdAt',
            header: () => <Trans>Time</Trans>,
            cell: ({ row }) => <DateTime value={row.original.createdAt} />,
        },
        {
            accessorKey: 'toolName',
            header: () => <Trans>Tool</Trans>,
            cell: ({ row }) => <span className="font-mono text-sm">{row.original.toolName}</span>,
        },
        {
            id: 'actor',
            header: () => <Trans>Actor</Trans>,
            cell: ({ row }) => (
                <div className="flex items-center gap-2">
                    <span className="text-sm">{row.original.actor ?? '—'}</span>
                    <Badge variant="outline">{row.original.actorType}</Badge>
                </div>
            ),
        },
        {
            accessorKey: 'status',
            header: () => <Trans>Status</Trans>,
            cell: ({ row }) => <StatusBadge status={row.original.status} />,
        },
        {
            accessorKey: 'durationMs',
            header: () => <Trans>Duration</Trans>,
            cell: ({ row }) => (row.original.durationMs == null ? '—' : `${row.original.durationMs} ms`),
        },
    ];

    return (
        <DataTable
            columns={columns}
            data={list?.items ?? []}
            totalItems={list?.totalItems ?? 0}
            isLoading={isLoading}
            page={page}
            itemsPerPage={pageSize}
            onPageChange={(_table, newPage, newPageSize) => {
                setPage(newPage);
                setPageSize(newPageSize);
            }}
            disableViewOptions
        />
    );
}
