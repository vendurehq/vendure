import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { Injector } from '../../common';
import { ConfigService } from '../../config/config.service';
import { Logger } from '../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../connection';
import { ProcessContext } from '../../process-context';
import { ScheduledTask } from '../../scheduler/scheduled-task';

import { DEFAULT_SCHEDULER_PLUGIN_OPTIONS } from './constants';
import { DefaultSchedulerStrategy } from './default-scheduler-strategy';
import { StaleTaskService } from './stale-task.service';

/**
 * A stand-in for a TypeORM QueryBuilder, where every builder method returns the
 * builder itself and `execute()` reports a single affected row.
 */
function createQueryBuilderStub() {
    const qb: any = {
        insert: () => qb,
        into: () => qb,
        values: () => qb,
        updateEntity: () => qb,
        orIgnore: () => qb,
        update: () => qb,
        set: () => qb,
        where: () => qb,
        andWhere: () => qb,
        execute: () => Promise.resolve({ affected: 1 }),
    };
    return qb;
}

describe('DefaultSchedulerStrategy', () => {
    let strategy: DefaultSchedulerStrategy;
    let updateRecord: ReturnType<typeof vi.fn>;
    let errorSpy: MockInstance<typeof Logger.error>;

    function createTask(execute: () => Promise<any>): ScheduledTask {
        return {
            id: 'test-task',
            options: { id: 'test-task', schedule: '* * * * *', execute },
            execute,
        } as unknown as ScheduledTask;
    }

    async function runFailingTask(error: unknown) {
        const task = createTask(() => Promise.reject(error));
        strategy.registerTask(task);
        await strategy.executeTask(task)();
    }

    beforeEach(() => {
        updateRecord = vi.fn().mockResolvedValue({ affected: 1 });
        const connection = {
            rawConnection: {
                isInitialized: true,
                options: { type: 'sqlite' },
                getRepository: () => ({
                    createQueryBuilder: () => createQueryBuilderStub(),
                    update: updateRecord,
                }),
            },
        };
        const staleTaskService = {
            cleanStaleLocksForTask: vi.fn().mockResolvedValue(undefined),
            getScheduleIntervalMs: () => 60_000,
        };
        const injector = {
            get: (token: any) => {
                switch (token) {
                    case TransactionalConnection:
                        return connection;
                    case DEFAULT_SCHEDULER_PLUGIN_OPTIONS:
                        return { defaultTimeout: 60_000, manualTriggerCheckInterval: 10_000 };
                    case StaleTaskService:
                        return staleTaskService;
                    case ConfigService:
                        return { schedulerOptions: { runTasksInWorkerOnly: true } };
                    case ProcessContext:
                        return { isWorker: false };
                    default:
                        throw new Error('Unexpected injection token');
                }
            },
        } as unknown as Injector;

        errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        strategy = new DefaultSchedulerStrategy();
        strategy.init(injector);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('logs the stack trace when a task fails', async () => {
        const error = new Error('Boom');

        await runFailingTask(error);

        expect(errorSpy).toHaveBeenCalledWith(
            'Scheduled task "test-task" failed with error: Boom',
            undefined,
            error.stack,
        );
    });

    it('falls back to the error class name when the message is empty', async () => {
        class EsputnikSyncError extends Error {}
        const error = new EsputnikSyncError();

        await runFailingTask(error);

        expect(errorSpy).toHaveBeenCalledWith(
            'Scheduled task "test-task" failed with error: EsputnikSyncError',
            undefined,
            error.stack,
        );
        expect(updateRecord).toHaveBeenCalledWith(
            { taskId: 'test-task' },
            expect.objectContaining({ lastResult: { error: 'EsputnikSyncError' } }),
        );
    });

    it('includes the cause chain, which the stack trace omits', async () => {
        const error = new Error('Could not sync contacts');
        (error as Error & { cause?: unknown }).cause = new Error('ECONNRESET');

        await runFailingTask(error);

        expect(errorSpy).toHaveBeenCalledWith(
            'Scheduled task "test-task" failed with error: Could not sync contacts caused by: ECONNRESET',
            undefined,
            error.stack,
        );
    });

    it('does not attempt to log a stack for a non-Error value', async () => {
        await runFailingTask('just a string');

        expect(errorSpy).toHaveBeenCalledWith(
            'Scheduled task "test-task" failed with error: Unknown error',
            undefined,
            undefined,
        );
    });
});
