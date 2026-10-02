import { UpdateScheduledTaskInput } from '@vendure/common/lib/generated-types';
import { Cron } from 'croner';
import ms, { type StringValue } from 'ms';
import { inspect } from 'node:util';

import { Injector } from '../../common';
import { assertFound } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection';
import { ProcessContext } from '../../process-context';
import { ScheduledTask } from '../../scheduler/scheduled-task';
import { SchedulerStrategy, TaskReport } from '../../scheduler/scheduler-strategy';

import {
    DEFAULT_LOCK_HOLD_FRACTION,
    DEFAULT_MAX_LOCK_HOLD_MS,
    DEFAULT_SCHEDULER_PLUGIN_OPTIONS,
    LOCK_REFRESH_FRACTION,
    MAX_LOCK_REFRESH_MS,
    TIMED_OUT_WARNING_INTERVAL_MS,
} from './constants';
import { ScheduledTaskRecord } from './scheduled-task-record.entity';
import { StaleTaskService } from './stale-task.service';
import { DefaultSchedulerPluginOptions } from './types';

interface RunningTask {
    task: ScheduledTask;
    /** The `lockedAt` value this run currently holds in the database. */
    lockedAt: Date;
    startedAt: number;
    /** Set when the run times out, then used to rate-limit "still running" warnings. */
    lastTimeoutWarningAt?: number;
    refreshTimer: NodeJS.Timeout;
    /** Serializes lock refreshes, so a release can wait for the last one. */
    refresh: Promise<void>;
}

/**
 * @description
 * The default {@link SchedulerStrategy} implementation that uses the database to
 * execute scheduled tasks. This strategy is configured when you use the
 * {@link DefaultSchedulerPlugin}.
 *
 * @since 3.3.0
 * @docsCategory scheduled-tasks
 */
export class DefaultSchedulerStrategy implements SchedulerStrategy {
    private connection: TransactionalConnection;
    private injector: Injector;
    private intervalRef: NodeJS.Timeout | undefined;
    private readonly tasks: Map<string, { task: ScheduledTask; isRegistered: boolean }> = new Map();
    private pluginOptions: DefaultSchedulerPluginOptions;
    private runningTasks: RunningTask[] = [];
    private staleTaskService: StaleTaskService;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        this.pluginOptions = injector.get(DEFAULT_SCHEDULER_PLUGIN_OPTIONS);
        this.injector = injector;
        this.staleTaskService = injector.get(StaleTaskService);

        const runTriggerCheck =
            injector.get(ConfigService).schedulerOptions.runTasksInWorkerOnly === false ||
            injector.get(ProcessContext).isWorker;

        if (runTriggerCheck) {
            this.intervalRef = setInterval(
                () => this.checkForManuallyTriggeredTasks(),
                this.pluginOptions.manualTriggerCheckInterval as number,
            );
        }
    }

    async destroy() {
        if (this.intervalRef) {
            clearInterval(this.intervalRef);
        }
        for (const running of [...this.runningTasks]) {
            if (await this.releaseLock(running)) {
                Logger.info(`Released lock for task "${running.task.id}"`);
            }
        }
    }

    registerTask(task: ScheduledTask): void {
        this.tasks.set(task.id, {
            task,
            isRegistered: false,
        });
    }

    executeTask(task: ScheduledTask) {
        return async (_job?: Cron) => {
            await this.runTask(task, { skipHoldCheck: false });
        };
    }

    private async runManually(task: ScheduledTask): Promise<void> {
        await this.runTask(task, { skipHoldCheck: true });
    }

    private async runTask(task: ScheduledTask, options: { skipHoldCheck: boolean }): Promise<void> {
        await this.ensureTaskIsRegistered(task);
        await this.staleTaskService.cleanStaleLocksForTask(task);

        const refreshMs = this.computeLockRefreshMs(task);
        const lockedAt = await this.tryAcquireLock(task, {
            skipHoldCheck: options.skipHoldCheck,
        });
        if (!lockedAt) {
            return;
        }

        Logger.verbose(`Executing scheduled task "${task.id}"`);
        // The lock is refreshed for the whole execution so that StaleTaskService does not
        // treat a long run as stale. A crashed worker stops refreshing, so its lock is still reclaimed.
        const running: RunningTask = {
            task,
            lockedAt,
            startedAt: Date.now(),
            refresh: Promise.resolve(),
            refreshTimer: setInterval(() => {
                running.refresh = running.refresh.then(() => this.refreshLock(running));
            }, refreshMs),
        };
        this.runningTasks.push(running);
        let execution: Promise<any> | undefined;
        let timedOut = false;
        try {
            const timeout = task.options.timeout ?? (this.pluginOptions.defaultTimeout as number);
            const timeoutMs = typeof timeout === 'number' ? timeout : ms(timeout as StringValue);

            let timeoutTimer: NodeJS.Timeout | undefined;
            const timeoutPromise = new Promise((_, reject) => {
                timeoutTimer = setTimeout(() => {
                    timedOut = true;
                    running.lastTimeoutWarningAt = Date.now();
                    Logger.warn(`Scheduled task ${task.id} timed out after ${timeoutMs}ms`);
                    reject(new Error('Task timed out'));
                }, timeoutMs);
            });

            let result: any;
            try {
                execution = task.execute(this.injector);
                result = await Promise.race([execution, timeoutPromise]);
            } finally {
                clearTimeout(timeoutTimer);
            }

            await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .update({ taskId: task.id }, { lastExecutedAt: new Date(), lastResult: result ?? '' });
            Logger.verbose(`Scheduled task "${task.id}" completed successfully`);
        } catch (error) {
            Logger.error(`Scheduled task "${task.id}" failed with error: ${inspect(error)}`);
            await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .update(
                    { taskId: task.id },
                    { lastExecutedAt: new Date(), lastResult: { error: errorLabel(error) } as any },
                );
        } finally {
            if (timedOut && execution) {
                // execute() cannot be cancelled, so the lock is held until it settles.
                // Its eventual result is not recorded: lastResult keeps the timeout error.
                void execution
                    .then(undefined, error =>
                        Logger.error(
                            `Timed-out scheduled task "${task.id}" failed with error: ${inspect(error)}`,
                        ),
                    )
                    .then(() => this.releaseLock(running));
            } else {
                await this.releaseLock(running);
            }
        }
    }

    private async refreshLock(running: RunningTask): Promise<void> {
        const { task } = running;
        const now = new Date();
        try {
            const result = await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .update({ taskId: task.id, lockedAt: running.lockedAt }, { lockedAt: now });
            if (!result.affected) {
                // Later refreshes cannot match either, and the release becomes a no-op.
                clearInterval(running.refreshTimer);
                Logger.warn(
                    `Scheduled task "${task.id}" lost its lock while still running, so another run may start`,
                );
                return;
            }
            running.lockedAt = now;
        } catch (error) {
            Logger.error(`Failed to refresh lock for task "${task.id}": ${inspect(error)}`);
            return;
        }
        const { lastTimeoutWarningAt } = running;
        if (
            lastTimeoutWarningAt !== undefined &&
            now.getTime() - lastTimeoutWarningAt >= TIMED_OUT_WARNING_INTERVAL_MS
        ) {
            running.lastTimeoutWarningAt = now.getTime();
            Logger.warn(
                `Scheduled task "${task.id}" timed out but is still running after ` +
                    `${now.getTime() - running.startedAt}ms, so it keeps its lock`,
            );
        }
    }

    /**
     * Releases the lock only if it still holds the value this run set, so a late
     * release cannot clear a lock acquired by another run. Returns whether a lock was released.
     */
    private async releaseLock(running: RunningTask): Promise<boolean> {
        clearInterval(running.refreshTimer);
        this.runningTasks = this.runningTasks.filter(r => r !== running);
        try {
            await running.refresh;
            const result = await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .update({ taskId: running.task.id, lockedAt: running.lockedAt }, { lockedAt: null });
            return !!result.affected;
        } catch (error) {
            Logger.error(`Failed to release lock for task "${running.task.id}": ${inspect(error)}`);
            return false;
        }
    }

    /**
     * Must stay well under the stale threshold used by StaleTaskService, which is the
     * schedule interval. Capped so long schedules do not overflow `setInterval`.
     */
    private computeLockRefreshMs(task: ScheduledTask): number {
        const intervalMs = this.getScheduleIntervalMs(task);
        if (intervalMs === undefined) {
            return MAX_LOCK_REFRESH_MS;
        }
        return Math.floor(Math.min(intervalMs * LOCK_REFRESH_FRACTION, MAX_LOCK_REFRESH_MS));
    }

    async getTasks(): Promise<TaskReport[]> {
        await this.ensureAllTasksAreRegistered();
        return this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .getMany()
            .then(tasks => {
                return tasks.map(task => this.entityToReport(task));
            });
    }

    async getTask(id: string): Promise<TaskReport | undefined> {
        await this.ensureTaskIsRegistered(id);
        return this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .where('task.taskId = :id', { id })
            .getOne()
            .then(task => (task ? this.entityToReport(task) : undefined));
    }

    async updateTask(input: UpdateScheduledTaskInput): Promise<TaskReport> {
        await this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .update()
            .set({ enabled: input.enabled })
            .where('taskId = :id', { id: input.id })
            .execute();
        return assertFound(this.getTask(input.id));
    }

    async triggerTask(task: ScheduledTask): Promise<void> {
        Logger.info(`Triggering task: ${task.id}`);
        await this.ensureTaskIsRegistered(task);
        await this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .update()
            .set({ manuallyTriggeredAt: new Date() })
            .where('taskId = :id', { id: task.id })
            .execute();
    }

    private async checkForManuallyTriggeredTasks() {
        // Since this is run on an interval, there is an edge case where, during shutdown,
        // the connection may not be initialized anymore.
        if (!this.connection.rawConnection.isInitialized) {
            return;
        }
        let taskEntities: ScheduledTaskRecord[] = [];
        try {
            taskEntities = await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .createQueryBuilder('task')
                .where('task.manuallyTriggeredAt IS NOT NULL')
                .getMany();
        } catch (e) {
            // This branch can be reached if the connection is closed and then this method
            // is called on the interval. Usually encountered in tests.
            const errorMessage = e instanceof Error ? e.message : 'Unknown error';
            Logger.error(`Error checking for manually triggered tasks: ${errorMessage}`);
        }

        Logger.debug(`Checking for manually triggered tasks: ${taskEntities.length}`);

        for (const taskEntity of taskEntities) {
            await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .update({ taskId: taskEntity.taskId }, { manuallyTriggeredAt: null });

            const task = this.tasks.get(taskEntity.taskId);
            if (task) {
                Logger.info(`Executing manually triggered task: ${task.task.id}`);
                void this.runManually(task.task);
            }
        }
    }

    private entityToReport(task: ScheduledTaskRecord): TaskReport {
        return {
            id: task.taskId,
            lastExecutedAt: task.lastExecutedAt,
            isRunning: task.lockedAt !== null,
            lastResult: task.lastResult,
            enabled: task.enabled,
        };
    }

    /**
     * Hold window after task completion during which scheduled re-acquisitions
     * are rejected. Prevents a worker with a lagging clock from re-running a
     * task that has just completed on a faster worker.
     */
    private computeLockHoldMs(task: ScheduledTask): number {
        const intervalMs = this.getScheduleIntervalMs(task);
        if (intervalMs === undefined) {
            return DEFAULT_MAX_LOCK_HOLD_MS;
        }
        return Math.floor(Math.min(intervalMs * DEFAULT_LOCK_HOLD_FRACTION, DEFAULT_MAX_LOCK_HOLD_MS));
    }

    /**
     * Returns the schedule interval, or `undefined` if it cannot be computed.
     */
    private getScheduleIntervalMs(task: ScheduledTask): number | undefined {
        try {
            const intervalMs = this.staleTaskService.getScheduleIntervalMs(task);
            return Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : undefined;
        } catch {
            return undefined;
        }
    }

    private async ensureAllTasksAreRegistered() {
        for (const task of this.tasks.values()) {
            await this.ensureTaskIsRegistered(task.task);
        }
    }

    /**
     * Attempts to acquire a lock for the given task.
     *
     * For databases that support pessimistic locking (PostgreSQL, MySQL, MariaDB),
     * we use SELECT ... FOR UPDATE to ensure only one worker can acquire the lock.
     * This is necessary because PostgreSQL's MVCC can allow multiple concurrent
     * UPDATE statements to succeed when using a simple "UPDATE ... WHERE lockedAt IS NULL" pattern.
     *
     * For databases that don't support pessimistic locking (SQLite, SQL.js),
     * we fall back to the atomic UPDATE approach which works correctly for single-connection scenarios.
     *
     * `skipHoldCheck` lets manual triggers bypass the post-completion hold
     * window (see `computeLockHoldMs`); they are already deduplicated via
     * `manuallyTriggeredAt` and have no inter-worker race.
     */
    private async tryAcquireLock(
        task: ScheduledTask,
        options: { skipHoldCheck?: boolean } = {},
    ): Promise<Date | undefined> {
        const lockedAt = new Date();
        const dbType = this.connection.rawConnection.options.type;
        const supportsPessimisticLocking = ['postgres', 'mysql', 'mariadb'].includes(dbType);
        const holdThreshold = options.skipHoldCheck
            ? null
            : new Date(Date.now() - this.computeLockHoldMs(task));

        if (supportsPessimisticLocking) {
            // Use a transaction with pessimistic locking to ensure only one worker
            // can acquire the lock.
            return this.connection.rawConnection.transaction(async manager => {
                // First, try to select the task row with a FOR UPDATE lock.
                // This will block other transactions trying to select the same row
                // until this transaction commits or rolls back.
                const qb = manager
                    .getRepository(ScheduledTaskRecord)
                    .createQueryBuilder('task')
                    .setLock('pessimistic_write')
                    .where('task.taskId = :taskId', { taskId: task.id })
                    .andWhere('task.lockedAt IS NULL')
                    .andWhere('task.enabled = TRUE');
                if (holdThreshold) {
                    qb.andWhere('(task.lastExecutedAt IS NULL OR task.lastExecutedAt <= :holdThreshold)', {
                        holdThreshold,
                    });
                }
                const taskRecord = await qb.getOne();

                if (!taskRecord) {
                    // Task is either already locked, disabled, or doesn't exist
                    return undefined;
                }

                // Now update the lock within the same transaction
                await manager.getRepository(ScheduledTaskRecord).update({ id: taskRecord.id }, { lockedAt });

                return lockedAt;
            });
        } else {
            // For databases without pessimistic locking support (SQLite, SQL.js),
            // use the atomic UPDATE approach. This works for single-connection scenarios
            // but may have race conditions with multiple connections.
            const qb = this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .createQueryBuilder('task')
                .update()
                .set({ lockedAt })
                .where('taskId = :taskId', { taskId: task.id })
                .andWhere('lockedAt IS NULL')
                .andWhere('enabled = TRUE');
            if (holdThreshold) {
                qb.andWhere('(lastExecutedAt IS NULL OR lastExecutedAt <= :holdThreshold)', {
                    holdThreshold,
                });
            }
            const result = await qb.execute();

            return result.affected ? lockedAt : undefined;
        }
    }

    private async ensureTaskIsRegistered(taskOrId: ScheduledTask | string) {
        const taskId = typeof taskOrId === 'string' ? taskOrId : taskOrId.id;
        const task = this.tasks.get(taskId);
        if (task && !task.isRegistered) {
            await this.connection.rawConnection
                .getRepository(ScheduledTaskRecord)
                .createQueryBuilder()
                .insert()
                .into(ScheduledTaskRecord)
                .values({ taskId })
                // Fix for versions lower than MariaDB v10.5 and MySQL: updateEntity(false) prevents TypeORM from
                // using the RETURNING clause after an INSERT. Keep in mind that this query won't return the id of the inserted record.
                .updateEntity(false)
                .orIgnore()
                .execute();

            this.tasks.set(taskId, { task: task.task, isRegistered: true });
        }
    }
}

/**
 * `constructor.name` rather than `name` because a subclass which does not set `name`
 * still inherits `'Error'` from `Error.prototype`.
 */
function errorLabel(error: unknown): string {
    if (!(error instanceof Error)) {
        return 'Unknown error';
    }
    return error.message || error.constructor.name;
}
