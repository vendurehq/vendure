import { Trans, useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Badge,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    useQuery,
} from '@vendure/dashboard';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { mcpStatsQuery } from '../mcp.graphql';

type TimeRange = '1h' | '24h' | '7d' | '30d';

function StatTile({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
    return (
        <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
        </div>
    );
}

function formatPercent(fraction: number): string {
    return `${(fraction * 100).toFixed(1)}%`;
}

function formatLatency(ms: number | null): string {
    return ms == null ? '—' : `${ms} ms`;
}

/**
 * Shows MCP usage stats for a selectable time window. The time range must be one
 * of the exact values the `mcpStats` query accepts (1h, 24h, 7d, 30d).
 */
export function StatsBlock() {
    const { t } = useLingui();
    const [timeRange, setTimeRange] = useState<TimeRange>('24h');

    const rangeLabels: Record<TimeRange, string> = {
        '1h': t`Last hour`,
        '24h': t`Last 24 hours`,
        '7d': t`Last 7 days`,
        '30d': t`Last 30 days`,
    };

    const { data, isLoading, error } = useQuery({
        queryKey: ['mcp-stats', timeRange],
        queryFn: () => api.query(mcpStatsQuery, { timeRange }),
    });

    const stats = data?.mcpStats;

    if (error) {
        return (
            <Alert variant="destructive">
                <TriangleAlert className="h-4 w-4" />
                <AlertDescription>
                    <Trans>Error loading MCP statistics: {error.message}</Trans>
                </AlertDescription>
            </Alert>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-muted-foreground">
                    <Trans>Usage over the selected period</Trans>
                </div>
                <Select
                    items={rangeLabels}
                    value={timeRange}
                    onValueChange={value => {
                        if (value) setTimeRange(value);
                    }}
                >
                    <SelectTrigger className="w-40">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {(Object.keys(rangeLabels) as TimeRange[]).map(key => (
                            <SelectItem key={key} value={key}>
                                {rangeLabels[key]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {isLoading && !stats ? (
                <Skeleton className="h-24 w-full" />
            ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <StatTile label={<Trans>Total calls</Trans>} value={stats?.totalCalls ?? 0} />
                    <StatTile
                        label={<Trans>Success rate</Trans>}
                        value={formatPercent(stats?.successRate ?? 0)}
                    />
                    <StatTile
                        label={<Trans>Error rate</Trans>}
                        value={formatPercent(stats?.errorRate ?? 0)}
                    />
                    <StatTile
                        label={<Trans>p50 latency</Trans>}
                        value={formatLatency(stats?.p50LatencyMs ?? null)}
                    />
                    <StatTile
                        label={<Trans>p95 latency</Trans>}
                        value={formatLatency(stats?.p95LatencyMs ?? null)}
                    />
                    <StatTile
                        label={<Trans>Calls per hour</Trans>}
                        value={(stats?.callsPerHour ?? 0).toFixed(1)}
                    />
                </div>
            )}

            <div className="space-y-2">
                <div className="text-sm font-medium">
                    <Trans>Top tools</Trans>
                </div>
                {stats && stats.topTools.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {stats.topTools.map(tool => (
                            <Badge key={tool.toolName} variant="secondary">
                                {tool.toolName}
                                <span className="ml-1 text-muted-foreground tabular-nums">{tool.count}</span>
                            </Badge>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        <Trans>No calls recorded in this period.</Trans>
                    </p>
                )}
            </div>
        </div>
    );
}
