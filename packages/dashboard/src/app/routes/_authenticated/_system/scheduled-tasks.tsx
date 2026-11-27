import { IdentifierDisplay } from '@/vdb/components/data-display/identifier.js';
import { JsonViewer } from '@/vdb/components/data-display/json-viewer.js';
import { DataTable } from '@/vdb/components/data-table/data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { RelativeTime } from '@/vdb/components/ui/relative-time.js';
import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import { defineStateEntries, StatusBadge } from '@/vdb/components/ui/status-badge.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import {
    FullWidthPageBlock,
    Page,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { DateTime } from '@vendure-io/ui/components/molecules/date-time';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { CirclePlay, EllipsisIcon, FileJson } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

// A scheduled task's enablement and execution status. `running` means the task
// is executing right now (progress — renders a pulsing dot). Enabled is the
// expected default and stays calm; disabled is the exception worth spotting
// (critical, matching BooleanDisplayBadge). Keys are the local flag values,
// not wire states.
const scheduledTaskStateDictionary = defineStateEntries({
    enabled: { tone: 'neutral', defaultLabel: 'Enabled' },
    disabled: { tone: 'critical', defaultLabel: 'Disabled' },
    running: { tone: 'progress', defaultLabel: 'Running' },
});

export const Route = createFileRoute('/_authenticated/_system/scheduled-tasks')({
    component: ScheduledTasksPage,
    loader: () => ({ breadcrumb: () => <Trans>Scheduled Tasks</Trans> }),
});

const getScheduledTasksDocument = graphql(`
    query ScheduledTasks {
        scheduledTasks {
            id
            description
            schedule
            scheduleDescription
            timezone
            lastExecutedAt
            nextExecutionAt
            isRunning
            lastResult
            enabled
        }
    }
`);

const updateScheduledTaskDocument = graphql(`
    mutation UpdateScheduledTask($input: UpdateScheduledTaskInput!) {
        updateScheduledTask(input: $input) {
            id
            enabled
        }
    }
`);

const runScheduledTaskDocument = graphql(`
    mutation RunScheduledTask($id: String!) {
        runScheduledTask(id: $id) {
            success
        }
    }
`);

type ScheduledTask = ResultOf<typeof getScheduledTasksDocument>['scheduledTasks'][number];

function ScheduledTasksPage() {
    const { t } = useLingui();
    // The task whose last result is open in the dialog. The result opens from the row menu,
    // so the table needs no column for it and fits its card.
    const [resultTask, setResultTask] = useState<ScheduledTask>();
    const { data } = useQuery({
        queryKey: ['scheduledTasks'],
        queryFn: () => api.query(getScheduledTasksDocument),
    });
    const queryClient = useQueryClient();
    const { mutate: updateScheduledTask } = useMutation({
        mutationFn: api.mutate(updateScheduledTaskDocument),
        onSuccess: result => {
            refreshScheduledTasks();
        },
    });
    const refreshScheduledTasks = () => {
        queryClient.invalidateQueries({ queryKey: ['scheduledTasks'] });
    };
    const { mutate: runScheduledTask } = useMutation({
        mutationFn: api.mutate(runScheduledTaskDocument),
        onSuccess: result => {
            if ((result as ResultOf<typeof runScheduledTaskDocument>).runScheduledTask.success) {
                toast.success(t`Scheduled task will be executed`);
                queryClient.invalidateQueries({ queryKey: ['scheduledTasks'] });
            } else {
                toast.error(t`Scheduled task could not be executed`);
            }
        },
    });
    // Month, day and time: the next run is at most a few weeks away, so the year and the
    // seconds only make the column wider.
    const intlDateOptions = {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
    } as const;

    const columnHelper = createColumnHelper<ScheduledTask>();
    const columns = [
        columnHelper.accessor('id', {
            header: t`ID`,
            cell: ({ getValue }) => <IdentifierDisplay value={getValue()} />,
        }),
        columnHelper.accessor('description', {
            header: t`Description`,
            // A long description is cut to one line, so the table fits its card.
            cell: ({ getValue }) => (
                <Tooltip>
                    <TooltipTrigger render={<div className="max-w-48 truncate" />}>{getValue()}</TooltipTrigger>
                    <TooltipContent className="max-w-80">{getValue()}</TooltipContent>
                </Tooltip>
            ),
        }),
        columnHelper.accessor('enabled', {
            header: t`Status`,
            cell: ({ row }) => {
                // A running task and a disabled task are the exceptions and always show.
                // Enabled is the normal state: it shows only while the row is hovered or focused.
                if (row.original.isRunning) {
                    return (
                        <StatusBadge tone={scheduledTaskStateDictionary.toneFor('running')}>
                            <Trans>Running</Trans>
                        </StatusBadge>
                    );
                }
                return (
                    <StatusBadge
                        tone={scheduledTaskStateDictionary.toneFor(
                            row.original.enabled ? 'enabled' : 'disabled',
                        )}
                        reveal={row.original.enabled ? 'row' : 'always'}
                    >
                        {row.original.enabled ? <Trans>Enabled</Trans> : <Trans>Disabled</Trans>}
                    </StatusBadge>
                );
            },
        }),
        columnHelper.accessor('schedule', {
            header: t`Schedule Pattern`,
        }),
        columnHelper.accessor('scheduleDescription', {
            header: t`Schedule`,
            cell: ({ row }) => (
                <div>
                    {row.original.scheduleDescription}
                    {row.original.timezone && (
                        <span className="text-muted-foreground"> ({row.original.timezone})</span>
                    )}
                </div>
            ),
        }),
        columnHelper.accessor('lastExecutedAt', {
            header: t`Last Executed`,
            cell: ({ row }) => {
                return row.original.lastExecutedAt ? (
                    <RelativeTime value={row.original.lastExecutedAt} className="whitespace-nowrap" />
                ) : (
                    <Trans>Never</Trans>
                );
            },
        }),
        columnHelper.accessor('nextExecutionAt', {
            header: t`Next Execution`,
            cell: ({ row }) => {
                return row.original.nextExecutionAt ? (
                    <DateTime
                        value={row.original.nextExecutionAt}
                        formatOptions={intlDateOptions}
                        className="whitespace-nowrap"
                    />
                ) : (
                    <Trans>Never</Trans>
                );
            },
        }),
        columnHelper.display({
            id: 'actions',
            header: t`Actions`,
            cell: ({ row }) => {
                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger
                            render={<Button variant="ghost" size="icon" aria-label={t`More actions`} />}
                        >
                            <EllipsisIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                            {row.original.lastResult ? (
                                <DropdownMenuItem onClick={() => setResultTask(row.original)}>
                                    <FileJson className="w-4 h-4" />
                                    <Trans>View result</Trans>
                                </DropdownMenuItem>
                            ) : null}
                            {row.original.enabled && (
                                <DropdownMenuItem
                                    onClick={() =>
                                        runScheduledTask({
                                            id: row.original.id,
                                        })
                                    }
                                >
                                    <CirclePlay className="w-4 h-4" />
                                    <Trans>Run</Trans>
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                                onClick={() =>
                                    updateScheduledTask({
                                        input: { id: row.original.id, enabled: !row.original.enabled },
                                    })
                                }
                            >
                                {row.original.enabled ? <Trans>Disable</Trans> : <Trans>Enable</Trans>}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                );
            },
        }),
    ];

    return (
        <Page pageId="scheduled-tasks-list">
            <PageTitle>
                <Trans>Scheduled Tasks</Trans>
            </PageTitle>
            <PageLayout>
                <FullWidthPageBlock blockId="list-table">
                    <DataTable
                        onRefresh={refreshScheduledTasks}
                        columns={columns}
                        data={data?.scheduledTasks}
                        totalItems={data?.scheduledTasks?.length ?? null}
                        defaultColumnVisibility={{
                            schedule: false,
                        }}
                    />
                </FullWidthPageBlock>
            </PageLayout>
            <Dialog open={!!resultTask} onOpenChange={open => !open && setResultTask(undefined)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            <Trans>View job result</Trans>
                        </DialogTitle>
                        <DialogDescription>
                            <Trans>The result of the job</Trans>
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="max-h-[600px]">
                        <JsonViewer viewOnly data={resultTask?.lastResult} collapse={1} rootFontSize={12} />
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </Page>
    );
}
