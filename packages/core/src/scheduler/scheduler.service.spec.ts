// The module graph has a cycle: `scheduled-task.ts` reaches `default-config` through the
// service layer, and `default-config` constructs `cleanSessionsTask` from the
// still-initialising `scheduled-task` module. Importing `default-config` first, as the
// package entry point does, avoids `ScheduledTask is not a constructor`.
import '../config/default-config';

import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { ConfigService } from '../config/config.service';
import { Logger } from '../config/logger/vendure-logger';
import { ProcessContext } from '../process-context/process-context';

import { ScheduledTask } from './scheduled-task';
import { SchedulerStrategy, TaskReport } from './scheduler-strategy';
import { SchedulerService } from './scheduler.service';

type ConfigServiceArg = ConstructorParameters<typeof SchedulerService>[0];
type ProcessContextArg = ConstructorParameters<typeof SchedulerService>[1];

function createTask(config: { id: string; schedule: string; timezone?: string }) {
    return new ScheduledTask({
        ...config,
        execute: () => Promise.resolve(),
    });
}

function createMockStrategy() {
    return {
        registerTask: vi.fn(),
        executeTask: vi.fn(() => () => undefined),
        getTasks: vi.fn<() => Promise<TaskReport[]>>(),
        getTask: vi.fn(() => Promise.resolve(undefined)),
        updateTask: vi.fn(),
        triggerTask: vi.fn(),
    };
}

// A bootstrapped service registers named croner jobs, and a name stays taken until the
// job is stopped. The `afterEach` hook below shuts down everything collected here.
const services: SchedulerService[] = [];

function bootstrapService(tasks: ScheduledTask[], timezone?: string) {
    const strategy = createMockStrategy();
    const configService = {
        schedulerOptions: {
            schedulerStrategy: strategy,
            tasks,
            runTasksInWorkerOnly: true,
            timezone,
        },
    } as unknown as ConfigServiceArg;
    const processContext = { isWorker: true } as ProcessContextArg;
    const service = new SchedulerService(configService, processContext);
    service.onApplicationBootstrap();
    services.push(service);
    strategy.getTasks.mockResolvedValue(
        tasks.map(task => ({
            id: task.id,
            lastExecutedAt: null,
            isRunning: false,
            lastResult: null,
            enabled: true,
        })),
    );
    return service;
}

describe('SchedulerService timezone handling', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // A Wednesday in January, far from any DST transition: 12:00 UTC
        vi.setSystemTime(new Date('2026-01-07T12:00:00Z'));
    });

    afterEach(async () => {
        for (const service of services.splice(0)) {
            await service.onApplicationShutdown();
        }
        vi.useRealTimers();
    });

    async function getNextExecution(schedule: string, taskTimezone?: string, globalTimezone?: string) {
        const task = createTask({ id: 'test-task', schedule, timezone: taskTimezone });
        const service = bootstrapService([task], globalTimezone);
        const [taskInfo] = await service.getTaskList();
        return taskInfo.nextExecutionAt;
    }

    it('evaluates the schedule in the global timezone', async () => {
        const nextRun = await getNextExecution('0 2 * * *', undefined, 'UTC');
        expect(nextRun?.toISOString()).toBe('2026-01-08T02:00:00.000Z');
    });

    it('a non-UTC global timezone shifts the execution time', async () => {
        // 02:00 in New York (EST, UTC-5) is 07:00 UTC
        const nextRun = await getNextExecution('0 2 * * *', undefined, 'America/New_York');
        expect(nextRun?.toISOString()).toBe('2026-01-08T07:00:00.000Z');
    });

    it('task-level timezone takes precedence over the global timezone', async () => {
        // 02:00 in Stockholm (CET, UTC+1) is 01:00 UTC
        const nextRun = await getNextExecution('0 2 * * *', 'Europe/Stockholm', 'America/New_York');
        expect(nextRun?.toISOString()).toBe('2026-01-08T01:00:00.000Z');
    });

    it('throws a descriptive error at bootstrap for an invalid task timezone', () => {
        const task = createTask({ id: 'bad-tz-task', schedule: '0 2 * * *', timezone: 'Not/AZone' });
        expect(() => bootstrapService([task])).toThrowError(
            /Invalid timezone "Not\/AZone" configured for the scheduled task "bad-tz-task"/,
        );
    });

    it('throws a descriptive error at bootstrap for an invalid global timezone', () => {
        const task = createTask({ id: 'good-tz-task', schedule: '0 2 * * *' });
        expect(() => bootstrapService([task], 'Not/AZone')).toThrowError(
            /Invalid timezone "Not\/AZone" configured for the `schedulerOptions.timezone` option/,
        );
    });

    it('validates the timezone even when no scheduler strategy is configured', () => {
        const task = createTask({ id: 'bad-tz-task', schedule: '0 2 * * *', timezone: 'Not/AZone' });
        const configService = { schedulerOptions: { tasks: [task] } } as unknown as ConfigServiceArg;
        const service = new SchedulerService(configService, { isWorker: true } as ProcessContextArg);
        expect(() => service.onApplicationBootstrap()).toThrowError(/Invalid timezone "Not\/AZone"/);
    });

    it('preserves process-local evaluation when no timezone is configured', async () => {
        const nextRun = await getNextExecution('0 2 * * *');
        // The exact instant depends on the process timezone. The local wall-clock time
        // does not: 2026-01-08 has no DST transition anywhere, so it is 02:00 in every
        // process timezone.
        expect(nextRun?.getHours()).toBe(2);
        expect(nextRun?.getMinutes()).toBe(0);
    });

    it('timezone set via task.configure() is applied', async () => {
        // 02:00 in Stockholm (CET, UTC+1) is 01:00 UTC
        const task = createTask({ id: 'configured-task', schedule: '0 2 * * *' }).configure({
            timezone: 'Europe/Stockholm',
        });
        const service = bootstrapService([task]);
        const [taskInfo] = await service.getTaskList();
        expect(taskInfo.nextExecutionAt?.toISOString()).toBe('2026-01-08T01:00:00.000Z');
    });

    it('exposes the effective timezone as its own field', async () => {
        const task = createTask({ id: 'described-task', schedule: '0 2 * * *' });
        const service = bootstrapService([task], 'Europe/Stockholm');
        const [taskInfo] = await service.getTaskList();
        expect(taskInfo.timezone).toBe('Europe/Stockholm');
        expect(taskInfo.scheduleDescription).toBe('At 02:00 AM');
    });

    it('reports a null timezone when none is configured', async () => {
        const task = createTask({ id: 'no-tz-task', schedule: '0 2 * * *' });
        const service = bootstrapService([task]);
        const [taskInfo] = await service.getTaskList();
        expect(taskInfo.timezone).toBeNull();
    });
});

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
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining('was blocked because an existing task is still running'),
        );

        finishRun();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(started).toBe(2);
        finishRun();
    });

    it('waits for a running task to finish before shutting down', async () => {
        let finishRun: () => void = () => undefined;
        service = createService(
            everySecondTask(true),
            () => () => new Promise<void>(resolve => (finishRun = resolve)),
        );
        service.onApplicationBootstrap();
        await vi.advanceTimersByTimeAsync(1_000);

        let shutDown = false;
        const shutdown = service.onApplicationShutdown().then(() => (shutDown = true));
        await vi.advanceTimersByTimeAsync(500);

        expect(shutDown).toBe(false);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Waiting for 1 running tasks'));

        finishRun();
        await vi.advanceTimersByTimeAsync(100);
        await shutdown;

        expect(shutDown).toBe(true);
    });

    it('logs a rejected task execution and does not wait for it on shutdown', async () => {
        service = createService(everySecondTask(false), () => () => Promise.reject(new Error('boom')));
        service.onApplicationBootstrap();

        await vi.advanceTimersByTimeAsync(1_000);
        await service.onApplicationShutdown();

        expect(errorSpy).toHaveBeenCalledWith('Error executing scheduled task slow-task: boom');
        expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Waiting for'));
    });
});
