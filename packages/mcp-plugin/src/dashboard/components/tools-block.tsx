import { Trans, useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    type ColumnDef,
    DataTable,
    DataTableColumnHeader,
    getFilteredRowModel,
    getSortedRowModel,
    type ResultOf,
    Switch,
    toast,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import { mcpToolsQuery, setMcpToolEnabledDocument } from '../mcp.graphql';

type McpTool = ResultOf<typeof mcpToolsQuery>['mcpTools'][number];

function SafetyBadge({ behavior }: { behavior: McpTool['behavior'] }) {
    if (behavior === 'destructive') {
        return (
            <Badge variant="destructive">
                <Trans>Destructive</Trans>
            </Badge>
        );
    }
    if (behavior === 'readonly') {
        return (
            <Badge variant="secondary">
                <Trans>Read-only</Trans>
            </Badge>
        );
    }
    return (
        <Badge variant="warning">
            <Trans>Mutating</Trans>
        </Badge>
    );
}

export function ToolsBlock() {
    const { t } = useLingui();
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    const { data, isLoading, error } = useQuery({
        queryKey: ['mcp-tools'],
        queryFn: () => api.query(mcpToolsQuery),
    });

    const toggle = useMutation({
        mutationFn: (vars: { toolName: string; toolset: McpTool['toolset']; enabled: boolean }) =>
            api.mutate(setMcpToolEnabledDocument, vars),
        // Flip the switch in the cached list immediately so it doesn't sit in its
        // old position until the refetch lands. Rolled back if the server rejects.
        onMutate: async vars => {
            await qc.cancelQueries({ queryKey: ['mcp-tools'] });
            const previous = qc.getQueryData<ResultOf<typeof mcpToolsQuery>>(['mcp-tools']);
            qc.setQueryData<ResultOf<typeof mcpToolsQuery>>(['mcp-tools'], old =>
                old
                    ? {
                          ...old,
                          mcpTools: old.mcpTools.map(tool =>
                              tool.name === vars.toolName && tool.toolset === vars.toolset
                                  ? { ...tool, enabled: vars.enabled }
                                  : tool,
                          ),
                      }
                    : old,
            );
            return { previous };
        },
        onSuccess: () => {
            toast.success(t`Tool updated`);
        },
        onError: (_error, _vars, context) => {
            if (context?.previous) {
                qc.setQueryData(['mcp-tools'], context.previous);
            }
            toast.error(t`Could not update tool`);
        },
        // Refetch either way so the cache ends up matching the server.
        onSettled: () => {
            void qc.invalidateQueries({ queryKey: ['mcp-tools'] });
        },
    });

    const tools = data?.mcpTools ?? [];

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) {
            return tools;
        }
        return tools.filter(
            tool => tool.name.toLowerCase().includes(term) || tool.description.toLowerCase().includes(term),
        );
    }, [tools, search]);

    if (error) {
        return (
            <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                    <Trans>Error loading tools: {error.message}</Trans>
                </AlertDescription>
            </Alert>
        );
    }

    const columns: Array<ColumnDef<McpTool>> = [
        {
            accessorKey: 'name',
            header: headerContext => (
                <DataTableColumnHeader
                    headerContext={headerContext}
                    customConfig={{ header: () => <Trans>Name</Trans> }}
                />
            ),
            cell: ({ row }) => <span className="font-medium font-mono text-sm">{row.original.name}</span>,
        },
        {
            accessorKey: 'toolset',
            header: headerContext => (
                <DataTableColumnHeader
                    headerContext={headerContext}
                    customConfig={{ header: () => <Trans>Toolset</Trans> }}
                />
            ),

            filterFn: (row, columnId, filterValue: string[]) => filterValue.includes(row.getValue(columnId)),
            cell: ({ row }) => <Badge variant="outline">{row.original.toolset}</Badge>,
        },
        {
            accessorKey: 'pluginSource',
            header: headerContext => (
                <DataTableColumnHeader
                    headerContext={headerContext}
                    customConfig={{ header: () => <Trans>Plugin</Trans> }}
                />
            ),
            // The plugin that registered the tool, so operators can tell built-in tools apart
            // from ones their own plugins contribute.
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground">{row.original.pluginSource}</span>
            ),
        },
        {
            accessorKey: 'behavior',
            header: headerContext => (
                <DataTableColumnHeader
                    headerContext={headerContext}
                    customConfig={{ header: () => <Trans>Safety</Trans> }}
                />
            ),
            cell: ({ row }) => <SafetyBadge behavior={row.original.behavior} />,
        },
        {
            accessorKey: 'description',
            header: () => <Trans>Description</Trans>,
            cell: ({ row }) => (
                <span
                    className="text-sm text-muted-foreground line-clamp-2 max-w-md whitespace-normal"
                    title={row.original.description}
                >
                    {row.original.description}
                </span>
            ),
        },
        {
            id: 'enabled',
            header: () => <Trans>Enabled</Trans>,
            cell: ({ row }) => (
                <Switch
                    checked={row.original.enabled}
                    onCheckedChange={checked =>
                        toggle.mutate({
                            toolName: row.original.name,
                            toolset: row.original.toolset,
                            enabled: checked,
                        })
                    }
                />
            ),
        },
    ];

    return (
        <DataTable
            columns={columns}
            data={filtered}
            totalItems={filtered.length}
            isLoading={isLoading}
            onSearchTermChange={term => setSearch(term)}
            facetedFilters={{
                toolset: {
                    title: t`Toolset`,
                    options: [
                        { label: 'admin', value: 'admin' },
                        { label: 'shop', value: 'shop' },
                    ],
                },
            }}
            onRefresh={() => {
                void qc.invalidateQueries({ queryKey: ['mcp-tools'] });
            }}
            setTableOptions={options => ({
                ...options,
                manualPagination: false,
                manualSorting: false,
                manualFiltering: false,
                rowCount: undefined,
                getSortedRowModel: getSortedRowModel(),
                getFilteredRowModel: getFilteredRowModel(),
                // Without this, any data refresh (e.g. the refetch after toggling
                // a tool) would jump the table back to page 1. Search and filter
                // changes still reset the page via the DataTable itself.
                autoResetPageIndex: false,
            })}
            page={page}
            itemsPerPage={pageSize}
            onPageChange={(_table, newPage, newPageSize) => {
                setPage(newPage);
                setPageSize(newPageSize);
            }}
        />
    );
}
