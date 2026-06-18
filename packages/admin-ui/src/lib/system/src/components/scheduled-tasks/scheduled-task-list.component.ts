import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { _ } from '@ngx-translate/core';
import {
    DataService,
    GetAllScheduledTasksQuery,
    NotificationService,
    RunTaskMutation,
    RunTaskMutationVariables,
    ToggleScheduledTaskEnabledMutation,
    ToggleScheduledTaskEnabledMutationVariables,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';

export const GET_SCHEDULED_TASKS_LIST = gql`
    query GetAllScheduledTasks {
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
`;

const TOGGLE_SCHEDULED_TASK_ENABLED = gql`
    mutation ToggleScheduledTaskEnabled($input: UpdateScheduledTaskInput!) {
        updateScheduledTask(input: $input) {
            id
            enabled
        }
    }
`;

const RUN_TASK = gql`
    mutation RunTask($id: String!) {
        runScheduledTask(id: $id) {
            success
        }
    }
`;

@Component({
    selector: 'vdr-scheduled-task-list',
    templateUrl: './scheduled-task-list.component.html',
    styleUrls: ['./scheduled-task-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ScheduledTaskListComponent implements OnInit {
    tasks$: Observable<GetAllScheduledTasksQuery['scheduledTasks']>;
    liveUpdate = new FormControl(true);

    constructor(
        private dataService: DataService,
        private notificationService: NotificationService,
    ) {}

    ngOnInit(): void {
        this.tasks$ = this.dataService
            .query<GetAllScheduledTasksQuery>(GET_SCHEDULED_TASKS_LIST)
            .mapStream(res => {
                return res.scheduledTasks;
            });
    }

    toggleEnabled(task: GetAllScheduledTasksQuery['scheduledTasks'][0]) {
        this.dataService
            .mutate<ToggleScheduledTaskEnabledMutation, ToggleScheduledTaskEnabledMutationVariables>(
                TOGGLE_SCHEDULED_TASK_ENABLED,
                {
                    input: {
                        id: task.id,
                        enabled: !task.enabled,
                    },
                },
            )
            .subscribe();
    }

    runTask(task: GetAllScheduledTasksQuery['scheduledTasks'][0]) {
        this.dataService
            .mutate<RunTaskMutation, RunTaskMutationVariables>(RUN_TASK, {
                id: task.id,
            })
            .subscribe(result => {
                if (result.runScheduledTask.success) {
                    this.notificationService.success(_('system.task-will-be-triggered'));
                } else {
                    this.notificationService.error(_('system.could-not-trigger-task'));
                }
            });
    }
}
