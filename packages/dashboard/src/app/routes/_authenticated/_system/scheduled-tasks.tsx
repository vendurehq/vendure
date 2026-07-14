import { CopyableText } from '@/vdb/components/shared/copyable-text.js';
import { DataTable } from '@/vdb/components/data-table/data-table.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
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
            cell: ({ getValue }) => <CopyableText value={getValue()}><span className="font-mono">{getValue()}</span></CopyableText>,
        }),
        columnHelper.accessor('description', {
            header: t`Description`,
        }),
        columnHelper.accessor('enabled', {
            header: t`Enabled`,
            cell: ({ row }) => {
                return row.original.enabled ? (
                    <Badge variant="success">
                        <Trans>Enabled</Trans>
                    </Badge>
                ) : (
                    <Badge variant="secondary">
                        <Trans>Disabled</Trans>
                    </Badge>
                );
            },
        }),
        columnHelper.accessor('schedule', {
            header: t`Schedule Pattern`,
        }),
        columnHelper.accessor('scheduleDescription', {
            header: t`Schedule`,
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
            cell: ({ row }) => {
                return row.original.isRunning ? (
                    <Badge variant="success">
                        <Trans>Running</Trans>
                    </Badge>
                ) : (
                    <Badge variant="secondary">
                        <Trans>Not Running</Trans>
                    </Badge>
                );
            },
        }),
        columnHelper.accessor('lastResult', {
            header: t`Last Result`,
            cell: ({ row }) => {
                return row.original.lastResult ? (
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
                ) : (
                    <div className="text-muted-foreground">
                        <Trans>No result yet</Trans>
                    </div>
                );
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
