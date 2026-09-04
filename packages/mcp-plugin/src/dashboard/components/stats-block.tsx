import { Trans, useLingui } from '@lingui/react/macro';
import {
    Alert,
    AlertDescription,
    api,
    Empty,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    Link,
    Progress,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Skeleton,
    useQuery,
} from '@vendure/dashboard';
import {
    ActivityIcon,
    CircleCheckIcon,
    CircleXIcon,
    ClockIcon,
    GaugeIcon,
    InfoIcon,
    TrendingUpIcon,
    TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';

import { mcpStatsQuery } from '../mcp.graphql';

import { TooltipButton } from './tooltip-button';

type TimeRange = '1h' | '24h' | '7d' | '30d';

function StatHint({ children }: { children: React.ReactNode }) {
    const { t } = useLingui();
    return (
        <TooltipButton
            tooltip={children}
            label={t`What this number means`}
            className="ml-1 inline-flex h-4 w-4 min-w-0 p-0 align-text-bottom text-muted-foreground"
        >
            <InfoIcon className="h-3 w-3" />
        </TooltipButton>
    );
}

function StatTile({
    icon,
    label,
    value,
    hint,
    children,
}: {
    icon: React.ReactNode;
    label: React.ReactNode;
    value: React.ReactNode;
    hint?: React.ReactNode;
    children?: React.ReactNode;
}) {
    return (
        <div className="rounded-md border border-border p-3 space-y-1">
            <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <span className="mt-px shrink-0">{icon}</span>
                <span>
                    {label}
                    {hint ? <StatHint>{hint}</StatHint> : null}
                </span>
            </div>
            <div className="text-2xl font-semibold tabular-nums">{value}</div>
            {children}
        </div>
    );
}

const regionsClasses = 'grid gap-4 @4xl:grid-cols-3';

const tilesClasses = '@4xl:col-span-2 grid grid-cols-2 @2xl:grid-cols-3 gap-3';

function StatsSkeleton() {
    return (
        <div className={regionsClasses}>
            <div className={tilesClasses}>
                {Array.from({ length: 6 }).map((_, index) => (
                    <Skeleton key={index} className="h-19 w-full" />
                ))}
            </div>
            <div className="space-y-2">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-6 w-full" />
            </div>
        </div>
    );
}

function TopToolsList({ tools }: { tools: Array<{ toolName: string; count: number }> }) {
    const topFive = tools.slice(0, 5);
    const maxCount = Math.max(...topFive.map(tool => tool.count));
    return (
        <div className="space-y-2">
            {topFive.map(tool => (
                <div key={tool.toolName} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="font-mono text-sm truncate">{tool.toolName}</span>
                        <span className="text-sm tabular-nums text-muted-foreground">{tool.count}</span>
                    </div>
                    <div className="h-1 rounded-full bg-primary/20">
                        <div
                            className="h-1 rounded-full bg-primary"
                            style={{ width: `${(tool.count / maxCount) * 100}%` }}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
}

function NoCallsRecorded() {
    return (
        <Empty className="border border-dashed p-6">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <ActivityIcon />
                </EmptyMedia>
                <EmptyTitle>
                    <Trans>No tool calls yet</Trans>
                </EmptyTitle>
                <EmptyDescription>
                    <Trans>No calls recorded in this period.</Trans>
                </EmptyDescription>
            </EmptyHeader>
        </Empty>
    );
}

function formatPercent(fraction: number): string {
    return `${(fraction * 100).toFixed(1)}%`;
}

function formatLatency(ms: number | null): string {
    return ms == null ? '—' : `${ms} ms`;
}

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

    const successRate = stats?.successRate ?? 0;
    // The API reports the error rate, not a count, so the tile works the count back out.
    const failedCalls = Math.round((stats?.totalCalls ?? 0) * (stats?.errorRate ?? 0));

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
                <StatsSkeleton />
            ) : (
                <div className={regionsClasses}>
                    <div className={tilesClasses}>
                        <StatTile
                            icon={<ActivityIcon className="h-3.5 w-3.5" />}
                            label={<Trans>Total calls</Trans>}
                            value={stats?.totalCalls ?? 0}
                        />
                        <StatTile
                            icon={<CircleCheckIcon className="h-3.5 w-3.5" />}
                            label={<Trans>Success rate</Trans>}
                            value={formatPercent(successRate)}
                        >
                            <Progress className="pt-1" value={successRate * 100} />
                        </StatTile>
                        <StatTile
                            icon={<CircleXIcon className="h-3.5 w-3.5" />}
                            label={<Trans>Failed calls</Trans>}
                            value={failedCalls}
                        />
                        <StatTile
                            icon={<GaugeIcon className="h-3.5 w-3.5" />}
                            label={<Trans>p50 latency</Trans>}
                            value={formatLatency(stats?.p50LatencyMs ?? null)}
                            hint={<Trans>Half of the calls in this period finished faster than this.</Trans>}
                        />
                        <StatTile
                            icon={<ClockIcon className="h-3.5 w-3.5" />}
                            label={<Trans>p95 latency</Trans>}
                            value={formatLatency(stats?.p95LatencyMs ?? null)}
                            hint={
                                <Trans>
                                    95 out of 100 calls in this period finished faster than this. It shows how
                                    slow the worst calls are.
                                </Trans>
                            }
                        />
                        <StatTile
                            icon={<TrendingUpIcon className="h-3.5 w-3.5" />}
                            label={<Trans>Calls per hour</Trans>}
                            value={(stats?.callsPerHour ?? 0).toFixed(1)}
                            hint={
                                <Trans>Average number of tool calls per hour over the selected period.</Trans>
                            }
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="text-sm font-medium">
                            <Trans>Top tools</Trans>
                        </div>
                        {stats && stats.topTools.length > 0 ? (
                            <>
                                <TopToolsList tools={stats.topTools} />
                                <Link
                                    to="/mcp-server/activity"
                                    className="inline-block text-sm text-primary hover:underline"
                                >
                                    <Trans>See all activity</Trans>
                                </Link>
                            </>
                        ) : (
                            <NoCallsRecorded />
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
