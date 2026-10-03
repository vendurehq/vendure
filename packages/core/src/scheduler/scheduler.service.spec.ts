import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ConfigService } from '../config/config.service';
import { Logger } from '../config/logger/vendure-logger';
import { ProcessContext } from '../process-context/process-context';

import { ScheduledTask } from './scheduled-task';
import { SchedulerStrategy } from './scheduler-strategy';
import { SchedulerService } from './scheduler.service';

describe('SchedulerService', () => {
    let service: SchedulerService;
    let warnSpy: MockInstance;
    let errorSpy: MockInstance;

    function createService(task: ScheduledTask, executeTask: SchedulerStrategy['executeTask']) {
        const schedulerStrategy = { executeTask } as unknown as SchedulerStrategy;
        const configService = {
            schedulerOptions: {
                schedulerStrategy,
                tasks: [task],
                runTasksInWorkerOnly: false,
            },
        } as unknown as ConfigService;
        return new SchedulerService(configService, new ProcessContext());
    }

    function everySecondTask(preventOverlap: boolean) {
        return {
            id: 'slow-task',
            options: { id: 'slow-task', schedule: '* * * * * *', preventOverlap },
        } as unknown as ScheduledTask;
    }

    function runningTasks() {
        return (service as any).runningTasks as number;
    }

    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Logger, 'info').mockImplementation(() => undefined);
        warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        const shutdown = service.onApplicationShutdown();
        await vi.advanceTimersByTimeAsync(10_000);
        await shutdown;
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not start an overlapping run while a long-running task is still in flight', async () => {
        let started = 0;
        let inFlight = 0;
        let maxInFlight = 0;
        let finishRun: () => void = () => undefined;
        service = createService(everySecondTask(true), () => async () => {
            started++;
            inFlight++;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await new Promise<void>(resolve => (finishRun = resolve));
            inFlight--;
        });
        service.onApplicationBootstrap();

        await vi.advanceTimersByTimeAsync(3_500);

        expect(started).toBe(1);
        expect(maxInFlight).toBe(1);
        expect(runningTasks()).toBe(1);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('was blocked because an existing task is still running'),
        );

        finishRun();
        await vi.advanceTimersByTimeAsync(0);

        expect(runningTasks()).toBe(0);

        await vi.advanceTimersByTimeAsync(1_000);

        expect(started).toBe(2);
    });

    it('logs a rejected task execution and releases the running count', async () => {
        service = createService(everySecondTask(false), () => () => Promise.reject(new Error('boom')));
        service.onApplicationBootstrap();

        await vi.advanceTimersByTimeAsync(1_000);

        expect(errorSpy).toHaveBeenCalledWith('Error executing scheduled task slow-task: boom');
        expect(runningTasks()).toBe(0);
    });
});
