// `ScheduledTask` imports DI tokens from the config module, so the config module must
// be evaluated first, as it is by the package entry point.
import '../config/default-config';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ScheduledTask } from './scheduled-task';
import { TaskReport } from './scheduler-strategy';
import { SchedulerService } from './scheduler.service';

// Derived from the constructor so the mocks stay in step with the real signatures.
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

// Bootstrapped services register named croner jobs, which stay registered until the
// job is stopped, so every service must be shut down again after the test.
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
        // The exact instant depends on the timezone of the test process, so we
        // assert on the local wall-clock time, which must be 02:00 in every
        // process timezone (2026-01-08 has no DST transition anywhere).
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
