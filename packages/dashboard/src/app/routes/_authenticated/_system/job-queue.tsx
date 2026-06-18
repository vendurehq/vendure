import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import {
    Ban,
    CheckIcon,
    ChevronDown,
    CircleXIcon,
    ClockIcon,
    LoaderIcon,
    MoreVertical,
    RefreshCw,
    RotateCcw,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CancelJobsBulkAction } from './components/cancel-jobs-bulk-action.js';
import { PayloadDialog } from './components/payload-dialog.js';
import { cancelJobDocument, jobListDocument, jobQueueListDocument } from './job-queue.graphql.js';

function formatDuration(ms: number): string {
    if (ms < 1000) {
        return `${ms}ms`;
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    const parts: string[] = [];

    if (days > 0) {
        parts.push(`${days}d`);
    }
    if (hours % 24 > 0) {
        parts.push(`${hours % 24}h`);
    }
    if (minutes % 60 > 0) {
        parts.push(`${minutes % 60}m`);
    }
    if (seconds % 60 > 0) {
        parts.push(`${seconds % 60}s`);
    }

    return parts.join(' ');
}

function getJobStateBadgeVariant(state: string) {
    switch (state) {
        case 'PENDING':
        case 'RETRYING':
            return 'warning';
        case 'COMPLETED':
            return 'success';
        case 'FAILED':
        case 'CANCELLED':
            return 'destructive';
        default:
            return 'secondary';
    }
}

export const Route = createFileRoute('/_authenticated/_system/job-queue')({
    component: JobQueuePage,
    loader: () => ({ breadcrumb: () => <Trans>Job Queue</Trans> }),
});

const STATES = [
    {
        label: 'Pending',
        value: 'PENDING',
        icon: ClockIcon,
    },
    {
        label: 'Completed',
        value: 'COMPLETED',
        icon: CheckIcon,
    },
    {
        label: 'Running',
        value: 'RUNNING',
        icon: LoaderIcon,
    },
    {
        label: 'Failed',
        value: 'FAILED',
        icon: CircleXIcon,
    },
    {
        label: 'Retrying',
        value: 'RETRYING',
        icon: RotateCcw,
    },
    {
        label: 'Cancelled',
        value: 'CANCELLED',
        icon: Ban,
    },
];

const REFRESH_INTERVALS = [
    { label: <Trans>Off</Trans>, value: 0 },
    { label: <Trans>Every 5 seconds</Trans>, value: 5000 },
    { label: <Trans>Every 10 seconds</Trans>, value: 10000 },
    { label: <Trans>Every 30 seconds</Trans>, value: 30000 },
    { label: <Trans>Every 60 seconds</Trans>, value: 60000 },
];

function JobQueuePage() {
    const refreshRef = useRef<() => void>(() => {});
    const { t } = useLingui();
    const { formatRelativeDate } = useLocalFormat();
    const [refreshInterval, setRefreshInterval] = useState(10000);
    const isActionMenuOpenRef = useRef(false);

    useEffect(() => {
        if (refreshInterval === 0) return;

        const interval = setInterval(() => {
            // Pause auto-refresh while the row action dropdown is open
            // to avoid closing it mid-interaction
            if (!isActionMenuOpenRef.current) {
                refreshRef.current();
            }
        }, refreshInterval);

        return () => clearInterval(interval);
    }, [refreshInterval]);

    const currentInterval = REFRESH_INTERVALS.find(i => i.value === refreshInterval);

    return (
        <ListPage
            pageId="job-queue-list"
            title={<Trans>Job Queue</Trans>}
            defaultSort={[{ id: 'createdAt', desc: true }]}
            listQuery={jobListDocument}
            route={Route}
            customizeColumns={{
                createdAt: {
                    cell: ({ row }) => (
                        <div title={row.original.createdAt}>{formatRelativeDate(row.original.createdAt)}</div>
                    ),
                },
                data: {
                    cell: ({ row }) => (
                        <PayloadDialog
                            payload={row.original.data}
                            title={<Trans>View job data</Trans>}
                            onOpenChange={open => (isActionMenuOpenRef.current = open)}
                            description={<Trans>The data that has been passed to the job</Trans>}
                            trigger={
                                <Button size="sm" variant="secondary">
                                    <Trans>View data</Trans>
                                </Button>
                            }
                        />
                    ),
                },
                queueName: {
                    cell: ({ row }) => <span className="font-mono">{row.original.queueName}</span>,
                },
                result: {
                    cell: ({ row }) => {
                        return row.original.result ? (
                            <PayloadDialog
                                payload={row.original.result}
                                title={<Trans>View job result</Trans>}
                                onOpenChange={open => (isActionMenuOpenRef.current = open)}
                                description={<Trans>The result of the job</Trans>}
                                trigger={
                                    <Button size="sm" variant="secondary">
                                        <Trans>View result</Trans>
                                    </Button>
                                }
                            />
                        ) : (
                            <div className="text-muted-foreground">
                                <Trans>No result yet</Trans>
                            </div>
                        );
                    },
                },
                state: {
                    cell: ({ row, table }) => {
                        const cancelJobMutation = useMutation({
                            mutationFn: (jobId: string) => api.mutate(cancelJobDocument, { jobId }),
                            onSuccess: () => {
                                refreshRef.current();
                            },
                        });
                        const state = STATES.find(s => s.value === row.original.state);
                        return (
                            <div className="flex items-center gap-2">
                                <Badge variant={getJobStateBadgeVariant(row.original.state)}>
                                    {state && (
                                        <state.icon
                                            className={
                                                row.original.state === 'RUNNING' ? 'animate-spin' : undefined
                                            }
                                        />
                                    )}
                                    {row.original.state}
                                </Badge>
                                {row.original.state === 'RUNNING' && (
                                    <DropdownMenu onOpenChange={open => (isActionMenuOpenRef.current = open)}>
                                        <DropdownMenuTrigger
                                            render={<Button variant="ghost" size="icon-xs" />}
                                        >
                                            <MoreVertical />
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem
                                                onClick={() => cancelJobMutation.mutate(row.original.id)}
                                                disabled={cancelJobMutation.isPending}
                                                className="text-destructive focus:text-destructive"
                                            >
                                                <Ban />
                                                <Trans>Cancel Job</Trans>
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </div>
                        );
                    },
                },
                duration: {
                    cell: ({ row }) => {
                        return row.original.duration ? formatDuration(row.original.duration) : null;
                    },
                },
            }}
            defaultVisibility={{
                isSettled: false,
                settledAt: false,
                progress: false,
                retries: false,
                attempts: false,
                error: false,
                startedAt: false,
            }}
            facetedFilters={{
                queueName: {
                    title: t`Queue`,
                    optionsFn: async () => {
                        return api.query(jobQueueListDocument).then(r => {
                            return r.jobQueues.map(queue => ({
                                label: queue.name,
                                value: queue.name,
                            }));
                        });
                    },
                },
                state: {
                    title: t`State`,
                    options: STATES,
                },
            }}
            bulkActions={[
                {
                    component: CancelJobsBulkAction,
                    order: 100,
                },
            ]}
            registerRefresher={refresher => {
                refreshRef.current = refresher;
            }}
        >
            <ActionBarItem itemId="auto-refresh-button">
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
                        <RefreshCw className="h-4 w-4" />
                        <span>
                            <Trans>Auto refresh: {currentInterval?.label}</Trans>
                        </span>
                        <ChevronDown className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        {REFRESH_INTERVALS.map(interval => (
                            <DropdownMenuItem
                                key={interval.value}
                                onClick={() => setRefreshInterval(interval.value)}
                                className={refreshInterval === interval.value ? 'bg-accent' : ''}
                            >
                                {interval.label}
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </ActionBarItem>
        </ListPage>
    );
}
