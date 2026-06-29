import { Injectable } from '@nestjs/common';
import CronTime from 'cron-time-generator';
import { Cron } from 'croner';

import { Instrument } from '../../common/instrument-decorator';
import { Logger } from '../../config';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ScheduledTask } from '../../scheduler';

import { loggerCtx } from './constants';
import { ScheduledTaskRecord } from './scheduled-task-record.entity';

/**
 * @description
 * This service finds and cleans stale locks, which can occur if a worker instance is
 * non-gracefully shut down while a task is ongoing, and the lock is never released.
 *
 * Failure to clean these stale locks will prevent the task from ever running again, since
 * workers will assume it is locked by another processes and will ignore it.
 */
@Injectable()
@Instrument()
export class StaleTaskService {
    // Cache the interval for each taskId
    private taskIntervalMap = new Map<string, number>();

    constructor(private connection: TransactionalConnection) {}

    /**
     * @description
     * Cleans stale task locks from the database.
     */
    async cleanStaleLocksForTask(task: ScheduledTask) {
        const now = new Date();
        try {
            const lockedTask = await this.fetchLockedTask(task.id);
            if (!lockedTask) {
                return;
            }
            const intervalMs = this.getScheduleIntervalMs(task);
            if (this.isStale(lockedTask, now, intervalMs)) {
                await this.clearStaleLock(lockedTask);
            }
        } catch (error) {
            Logger.error(
                `Error cleaning up stale task locks: ${error instanceof Error ? error.message : String(error)}`,
                loggerCtx,
            );
            throw error;
        }
    }

    private async fetchLockedTask(taskId: string): Promise<ScheduledTaskRecord | null> {
        return this.connection.rawConnection
            .getRepository(ScheduledTaskRecord)
            .createQueryBuilder('task')
            .select(['task.taskId', 'task.lockedAt'])
            .where('task.lockedAt IS NOT NULL')
            .andWhere('task.taskId = :taskId', { taskId })
            .getOne();
    }

    /**
     * Returns the interval in ms between one run of the task, and the next.
     */
    getScheduleIntervalMs(task: ScheduledTask): number {
        const cachedInterval = this.taskIntervalMap.get(task.id);
        if (cachedInterval) {
            return cachedInterval;
        }
        const schedule = task.options.schedule;
        const scheduleString = typeof schedule === 'function' ? schedule(CronTime) : schedule;
        const cron = new Cron(scheduleString);
        const nextFn: (d?: Date) => Date | null | undefined =
            typeof (cron as any).nextRun === 'function'
                ? (cron as any).nextRun.bind(cron)
                : (cron as any).next.bind(cron);
        const next1 = nextFn();
        if (!next1) {
            throw new Error('Could not compute next run times');
        }
        const next2 = nextFn(next1);
        if (!next2) {
            throw new Error('Could not compute next run times');
        }
        const interval = next2.getTime() - next1.getTime();
        this.taskIntervalMap.set(task.id, interval);
        return interval;
    }

    private isStale(task: ScheduledTaskRecord, now: Date, intervalMs: number): boolean {
        if (!task.lockedAt) {
            return false;
        }
        return now.getTime() - task.lockedAt.getTime() > intervalMs;
    }

    private async clearStaleLock(staleTask: ScheduledTaskRecord): Promise<void> {
        const repo = this.connection.rawConnection.getRepository(ScheduledTaskRecord);
        const result = await repo.update(
            { taskId: staleTask.taskId, lockedAt: staleTask.lockedAt ?? undefined },
            { lockedAt: null },
        );
        if (result.affected && result.affected > 0) {
            Logger.verbose(
                `Successfully cleaned stale task locks for task "${staleTask.taskId}", which was locked at ${staleTask.lockedAt?.toISOString() ?? 'unknown'}`,
                loggerCtx,
            );
        } else {
            Logger.debug(
                `Skipped clearing lock for task "${staleTask.taskId}" because the lock has changed since observation`,
                loggerCtx,
            );
        }
    }
}
