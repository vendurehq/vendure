import { Trans } from '@lingui/react/macro';
import {
    Badge,
    type ColumnFiltersState,
    PaginatedListDataTable,
    type SortingState,
} from '@vendure/dashboard';
import { useState } from 'react';

import { mcpToolCallLogsQuery } from '../mcp.graphql';

function StatusBadge({ status }: { status: string }) {
    const variant = status === 'success' ? 'success' : status === 'error' ? 'destructive' : 'secondary';
    return <Badge variant={variant}>{status}</Badge>;
}

/**
 * Shows the most recent MCP tool calls. The framework's paginated table works out the
 * columns from the query document, fetches only the columns currently on screen, and
 * sends sorting and filtering to the server.
 */
export function ActivityBlock() {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    // Newest first: the tool-call log query applies no ordering of its own.
    const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);

    return (
        <PaginatedListDataTable
            listQuery={mcpToolCallLogsQuery}
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
                    cell: ({ row }) => <span className="text-sm">{row.original.actor ?? '—'}</span>,
                },
                actorType: {
                    header: () => <Trans>Actor type</Trans>,
                    cell: ({ row }) => <Badge variant="outline">{row.original.actorType}</Badge>,
                },
                status: {
                    header: () => <Trans>Status</Trans>,
                    cell: ({ row }) => <StatusBadge status={row.original.status} />,
                },
                durationMs: {
                    header: () => <Trans>Duration</Trans>,
                    cell: ({ row }) =>
                        row.original.durationMs == null ? '—' : `${row.original.durationMs} ms`,
                },
            }}
            defaultColumnOrder={['createdAt', 'toolName', 'actor', 'actorType', 'status', 'durationMs']}
            defaultVisibility={{ id: false, pluginSource: false }}
        />
    );
}
