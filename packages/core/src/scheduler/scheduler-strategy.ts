import { UpdateScheduledTaskInput } from '@vendure/common/lib/generated-types';
import { Cron } from 'croner';

import { InjectableStrategy } from '../common';

import { ScheduledTask } from './scheduled-task';

/**
 * @description
 * A report on the status of a scheduled task.
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 * @docsPage SchedulerStrategy
 */
export interface TaskReport {
    id: string;
    lastExecutedAt: Date | null;
    isRunning: boolean;
    lastResult: any;
    enabled: boolean;
}

/**
 * @description
 * This strategy is used to define the mechanism by which scheduled tasks are executed
 * and how they are reported on. The main purpose of this strategy is to ensure
 * that a given task is executed exactly once at the scheduled time, even if there
 * are multiple instances of the worker running.
 *
 * To do this, the strategy must use some form of shared storage and a method of
 * locking so that only a single worker is allowed to execute the task.
 *
 * By default, the {@link DefaultSchedulerStrategy} will use the database to enable
 * this functionality.
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 * @docsPage SchedulerStrategy
 * @docsWeight 0
 */
export interface SchedulerStrategy extends InjectableStrategy {
    /**
     * @description
     * An optional method that may be used by the strategy to register all the configured
     * tasks ahead of time. This can be useful for keeping an internal reference of
     * all the tasks to aid in the specific strategy implemetation.
     */
    registerTask?(task: ScheduledTask): void;
    /**
     * @description
     * Execute a scheduled task. This method must also take care of
     * ensuring that the task is executed exactly once at the scheduled time,
     * even if there are multiple instances of the worker running.
     *
     * For instance, in the {@link DefaultSchedulerStrategy} we make use of a
     * dedicated database table and a locking mechansim. If you implement a custom
     * SchedulerStrategy, you must use some other form of shared locking mechanism
     * that could make use of something like Redis etc. to ensure that the task
     * is executed exactly once at the scheduled time.
     *
     * The function returned is then called in order to execture the task. The
     * `job` argument is an instance of the croner `Cron` class, except when
     * the task has been manually triggered, in which case it will be undefined.
     */
    executeTask(task: ScheduledTask): (job?: Cron) => Promise<any> | any;
    /**
     * @description
     * Get all scheduled tasks.
     */
    getTasks(): Promise<TaskReport[]>;
    /**
     * @description
     * Get a single scheduled task by its id.
     */
    getTask(id: string): Promise<TaskReport | undefined>;
    /**
     * @description
     * Manually trigger a given task. This method is not used to actually invoke the
     * task function itself, since that would cause the task to run on the server
     * instance which we typically do not want. Instead, it should be used
     * to signal to the strategy that this specific task needs to be invoked
     * at the soonest opportunity.
     *
     * For instance, in the {@link DefaultSchedulerStrategy} this is done by setting
     * a flag in the database table which is checked periodically and causes those tasks
     * to get immediately invoked.
     */
    triggerTask(task: ScheduledTask): Promise<void>;
    /**
     * @description
     * Update a scheduled task.
     */
    updateTask(input: UpdateScheduledTaskInput): Promise<TaskReport>;
}
