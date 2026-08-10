import { Trans, useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    type ColumnDef,
    DataTable,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
    toast,
    useMutation,
    useQuery,
    useQueryClient,
} from '@vendure/dashboard';
import { TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import { MCP_TOOLS_QUERY, McpToolInfo, SET_MCP_TOOL_ENABLED } from '../queries';

const ALL_TOOLSETS = '__all__';

function SafetyBadge({ tool }: { tool: McpToolInfo }) {
    if (tool.behavior === 'destructive') {
        return (
            <Badge variant="destructive">
                <Trans>Destructive</Trans>
            </Badge>
        );
    }
    if (tool.behavior === 'readonly') {
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

/**
 * Lists every registered MCP tool with its toolset, safety classification and a
 * toggle to enable/disable it. Toggling calls the server-enforced mutation
 * (gated by the UpdateMcpServer permission). Search and toolset filtering happen
 * client-side.
 */
export function ToolsBlock() {
    const { t } = useLingui();
    const qc = useQueryClient();
    const [search, setSearch] = useState('');
    const [toolset, setToolset] = useState<string>(ALL_TOOLSETS);

    const { data, isLoading, error } = useQuery({
        queryKey: ['mcp-tools'],
        queryFn: () => api.query<{ mcpTools: McpToolInfo[] }>(MCP_TOOLS_QUERY),
    });

    const toggle = useMutation({
        mutationFn: (vars: { toolName: string; toolset: string; enabled: boolean }) =>
            api.mutate(SET_MCP_TOOL_ENABLED, vars),
        onSuccess: () => {
            toast.success(t`Tool updated`);
            void qc.invalidateQueries({ queryKey: ['mcp-tools'] });
        },
        onError: () => {
            toast.error(t`Could not update tool`);
        },
    });

    const tools = data?.mcpTools ?? [];

    const toolsetItems = useMemo(() => {
        const names = Array.from(new Set(tools.map(tool => tool.toolset))).sort();
        const items: Record<string, string> = { [ALL_TOOLSETS]: t`All toolsets` };
        for (const name of names) {
            items[name] = name;
        }
        return items;
    }, [tools, t]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        return tools.filter(tool => {
            if (toolset !== ALL_TOOLSETS && tool.toolset !== toolset) {
                return false;
            }
            if (!term) {
                return true;
            }
            return tool.name.toLowerCase().includes(term) || tool.description.toLowerCase().includes(term);
        });
    }, [tools, search, toolset]);

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

    const columns: Array<ColumnDef<McpToolInfo>> = [
        {
            accessorKey: 'name',
            header: () => <Trans>Name</Trans>,
            cell: ({ row }) => <span className="font-medium font-mono text-sm">{row.original.name}</span>,
        },
        {
            accessorKey: 'toolset',
            header: () => <Trans>Toolset</Trans>,
            cell: ({ row }) => <Badge variant="outline">{row.original.toolset}</Badge>,
        },
        {
            accessorKey: 'pluginSource',
            header: () => <Trans>Plugin</Trans>,
            // The plugin that registered the tool, so operators can tell built-in tools apart
            // from ones their own plugins contribute.
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground">{row.original.pluginSource}</span>
            ),
        },
        {
            id: 'safety',
            header: () => <Trans>Safety</Trans>,
            cell: ({ row }) => <SafetyBadge tool={row.original} />,
        },
        {
            accessorKey: 'description',
            header: () => <Trans>Description</Trans>,
            cell: ({ row }) => (
                <span className="text-sm text-muted-foreground line-clamp-2">{row.original.description}</span>
            ),
        },
        {
            id: 'enabled',
            header: () => <Trans>Enabled</Trans>,
            cell: ({ row }) => (
                <Switch
                    checked={row.original.enabled}
                    disabled={toggle.isPending}
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
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    placeholder={t`Search tools...`}
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    className="h-8 w-full sm:w-64"
                />
                <Select
                    items={toolsetItems}
                    value={toolset}
                    onValueChange={value => value && setToolset(value)}
                >
                    <SelectTrigger className="h-8 w-48">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {Object.entries(toolsetItems).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                                {label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <DataTable
                columns={columns}
                data={filtered}
                totalItems={filtered.length}
                isLoading={isLoading}
                page={1}
                itemsPerPage={100}
                disableViewOptions
            />
        </div>
    );
}
