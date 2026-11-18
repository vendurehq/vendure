import { IdentifierDisplay } from '@/vdb/components/data-display/identifier.js';
import { DataTable } from '@/vdb/components/data-table/data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { defineStateEntries, StatusBadge } from '@/vdb/components/ui/status-badge.js';
import {
    FullWidthPageBlock,
    Page,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { createColumnHelper } from '@tanstack/react-table';
import { CirclePlay, EllipsisIcon } from 'lucide-react';
import { toast } from 'sonner';
import { PayloadDialog } from './components/payload-dialog.js';

// A scheduled task's enablement and execution status. `running` means the task
// is executing right now (progress — renders a pulsing dot). Enabled is the
// expected default and stays calm; disabled is the exception worth spotting
// (critical, matching BooleanDisplayBadge). Keys are the local flag values,
// not wire states.
// A per-row action that shows only while its row is hovered or holds keyboard focus, and
// always on touch screens, so the list reads as data at rest.
const ROW_ACTION_REVEAL_CLASS =
    'opacity-0 transition-opacity duration-quick ease-soft group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100';

const scheduledTaskStateDictionary = defineStateEntries({
    enabled: { tone: 'neutral', defaultLabel: 'Enabled' },
    disabled: { tone: 'critical', defaultLabel: 'Disabled' },
    running: { tone: 'progress', defaultLabel: 'Running' },
    idle: { tone: 'neutral', defaultLabel: 'Not Running' },
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
    const { formatDate, formatRelativeDate } = useLocalFormat();
    const intlDateOptions = {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
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
                <div className="max-w-80 truncate" title={getValue()}>
                    {getValue()}
                </div>
            ),
        }),
        columnHelper.accessor('enabled', {
            header: t`Status`,
            cell: ({ row }) => {
                // Enabled is the normal state: it shows only while the row is hovered or focused.
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
                    <div title={row.original.lastExecutedAt}>
                        {formatRelativeDate(row.original.lastExecutedAt)}
                    </div>
                ) : (
                    <Trans>Never</Trans>
                );
            },
        }),
        columnHelper.accessor('nextExecutionAt', {
            header: t`Next Execution`,
            cell: ({ row }) => {
                return row.original.nextExecutionAt ? (
                    formatDate(row.original.nextExecutionAt, intlDateOptions)
                ) : (
                    <Trans>Never</Trans>
                );
            },
        }),
        columnHelper.accessor('isRunning', {
            header: t`Running`,
            // Only a running task gets a badge; an idle one leaves the cell blank.
            cell: ({ row }) => {
                return row.original.isRunning ? (
                    <StatusBadge tone={scheduledTaskStateDictionary.toneFor('running')}>
                        <Trans>Running</Trans>
                    </StatusBadge>
                ) : null;
            },
        }),
        columnHelper.accessor('lastResult', {
            header: t`Last Result`,
            cell: ({ row }) => {
                return row.original.lastResult ? (
                    <span className={ROW_ACTION_REVEAL_CLASS}>
                        <PayloadDialog
                            payload={row.original.lastResult}
                            title={<Trans>View job result</Trans>}
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
        }),
        columnHelper.display({
            id: 'actions',
            header: t`Actions`,
            cell: ({ row }) => {
                return (
                    <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                            <EllipsisIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
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
                        data={data?.scheduledTasks ?? []}
                        totalItems={data?.scheduledTasks?.length ?? 0}
                        defaultColumnVisibility={{
                            schedule: false,
                        }}
                    />
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
