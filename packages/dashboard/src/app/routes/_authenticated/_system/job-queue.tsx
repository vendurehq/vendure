import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { defineStateEntries, StatusBadge } from '@/vdb/components/ui/status-badge.js';
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
    EllipsisIcon,
    LoaderIcon,
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

// Job-queue state dictionary. PENDING is a queued job waiting on the worker
// (neutral, not warning); RUNNING is actively executing (progress — renders a
// spinner); RETRYING needs attention (warning); FAILED is a hard failure
// (critical); CANCELLED is a terminal outcome, not a failure (neutral).
const jobStateDictionary = defineStateEntries({
    PENDING: { tone: 'neutral', defaultLabel: 'Pending' },
    RUNNING: { tone: 'progress', defaultLabel: 'Running' },
    RETRYING: { tone: 'warning', defaultLabel: 'Retrying' },
    COMPLETED: { tone: 'success', defaultLabel: 'Completed' },
    FAILED: { tone: 'critical', defaultLabel: 'Failed' },
    CANCELLED: { tone: 'neutral', defaultLabel: 'Cancelled' },
});

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

// A per-row action that shows only while its row is hovered or holds keyboard focus, and
// always on touch screens, so the list reads as data at rest.
const ROW_ACTION_REVEAL_CLASS =
    'opacity-0 transition-opacity duration-quick ease-soft group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100';

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
    const stateLabels: Record<string, string> = {
        PENDING: t`Pending`,
        RUNNING: t`Running`,
        RETRYING: t`Retrying`,
        COMPLETED: t`Completed`,
        FAILED: t`Failed`,
        CANCELLED: t`Cancelled`,
    };

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
                        <span className={ROW_ACTION_REVEAL_CLASS}>
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
                        </span>
                    ),
                },
                queueName: {
                    cell: ({ row }) => <span className="font-mono">{row.original.queueName}</span>,
                },
                result: {
                    cell: ({ row }) => {
                        // A job without a result leaves the cell blank.
                        return row.original.result ? (
                            <span className={ROW_ACTION_REVEAL_CLASS}>
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
                            </span>
                        ) : null;
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
                                {/* In a list the state is an icon and a label. Completed is the normal
                                    state, so it shows only while the row is hovered or focused. */}
                                <StatusBadge
                                    appearance="icon"
                                    tone={jobStateDictionary.toneFor(row.original.state)}
                                    // RUNNING keeps the progress tone's spinner.
                                    icon={
                                        state && row.original.state !== 'RUNNING' ? <state.icon /> : undefined
                                    }
                                    reveal={row.original.state === 'COMPLETED' ? 'row' : 'always'}
                                >
                                    {stateLabels[row.original.state] ?? row.original.state}
                                </StatusBadge>
                                {row.original.state === 'RUNNING' && (
                                    <DropdownMenu onOpenChange={open => (isActionMenuOpenRef.current = open)}>
                                        <DropdownMenuTrigger
                                            render={
                                                <Button
                                                    variant="ghost"
                                                    size="icon-xs"
                                                    aria-label={t`Actions for job ${row.original.id}`}
                                                />
                                            }
                                        >
                                            <EllipsisIcon />
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent>
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
                    <DropdownMenuContent>
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
