import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `default-config` must be evaluated before the ScheduledTask module chain,
// because it instantiates ScheduledTask at module scope and the ScheduledTask
// module's own imports lead back into the config module. This mirrors the
// load order of the package entry point. Type-only imports are elided at
// runtime, so a side-effect import is required.
import '../config/default-config';

import type { ConfigService } from '../config/config.service';
import type { ProcessContext } from '../process-context';

import { ScheduledTask } from './scheduled-task';
import { SchedulerStrategy, TaskReport } from './scheduler-strategy';
import { SchedulerService } from './scheduler.service';

function createTask(config: { id: string; schedule: string; timezone?: string }) {
    return new ScheduledTask({
        ...config,
        execute: () => Promise.resolve(),
    });
}

function createMockStrategy(): SchedulerStrategy {
    return {
        registerTask: vi.fn(),
        executeTask: vi.fn(() => () => undefined),
        getTasks: vi.fn((): Promise<TaskReport[]> => Promise.resolve([])),
        getTask: vi.fn(() => Promise.resolve(undefined)),
        updateTask: vi.fn(),
        triggerTask: vi.fn(),
    } as unknown as SchedulerStrategy;
}

function bootstrapService(tasks: ScheduledTask[], timezone?: string) {
    const strategy = createMockStrategy();
    const configService = {
        schedulerOptions: {
            schedulerStrategy: strategy,
            tasks,
            runTasksInWorkerOnly: true,
            timezone,
        },
    } as unknown as ConfigService;
    const processContext = { isWorker: true } as ProcessContext;
    const service = new SchedulerService(configService, processContext);
    service.onApplicationBootstrap();
    (strategy.getTasks as ReturnType<typeof vi.fn>).mockReturnValue(
        Promise.resolve(
            tasks.map(task => ({
                id: task.id,
                lastExecutedAt: null,
                isRunning: false,
                lastResult: null,
                enabled: true,
            })),
        ),
    );
    return service;
}

describe('SchedulerService timezone handling', () => {
    const services: SchedulerService[] = [];

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
        services.push(service);
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

    it('throws a descriptive error at bootstrap for an invalid timezone', () => {
        const task = createTask({ id: 'bad-tz-task', schedule: '0 2 * * *', timezone: 'Not/AZone' });
        expect(() => bootstrapService([task])).toThrowError(
            /Invalid timezone "Not\/AZone" configured for scheduled task "bad-tz-task"/,
        );
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
        services.push(service);
        const [taskInfo] = await service.getTaskList();
        expect(taskInfo.nextExecutionAt?.toISOString()).toBe('2026-01-08T01:00:00.000Z');
    });

    it('includes the effective timezone in the schedule description', async () => {
        const task = createTask({ id: 'described-task', schedule: '0 2 * * *' });
        const service = bootstrapService([task], 'Europe/Stockholm');
        services.push(service);
        const [taskInfo] = await service.getTaskList();
        expect(taskInfo.scheduleDescription).toBe('At 02:00 AM (Europe/Stockholm)');
    });
});
