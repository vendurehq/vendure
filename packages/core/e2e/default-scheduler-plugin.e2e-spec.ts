import { ConfigService, DefaultSchedulerPlugin, mergeConfig, ScheduledTask } from '@vendure/core';
import { createTestEnvironment, TestingLogger } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { getTasksDocument, runTaskDocument, updateTaskDocument } from './graphql/shared-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';
import { pollUntil } from './utils/poll-until';

// Mirrors DEFAULT_MAX_LOCK_HOLD_MS in default-scheduler-plugin/constants.ts.
const MAX_HOLD_MS = 5_000;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class EmptyMessageError extends Error {}

describe('Default scheduler plugin', () => {
    const taskSpy = vi.fn();
    const testingLogger = new TestingLogger(() => vi.fn());
    // One task per hold-window test so DB state can't leak between them.
    const holdSpyBlocking = vi.fn();
    const holdSpyManual = vi.fn();
    const timeoutSpy = vi.fn();
    const longRunSpy = vi.fn();
    const gate = () => {
        let release: () => void = () => undefined;
        const promise = new Promise<void>(resolve => (release = resolve));
        return { promise, release };
    };
    const timeoutGate = gate();
    const timeoutRejectGate = gate();
    const longRunGate = gate();

    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            schedulerOptions: {
                tasks: [
                    new ScheduledTask({
                        id: 'test-job',
                        description: "A test job that doesn't do anything",
                        schedule: cron => cron.everySaturdayAt(0, 0),
                        async execute(injector) {
                            taskSpy();
                            return { success: true };
                        },
                    }),
                    new ScheduledTask({
                        id: 'error-test-job',
                        description: 'A test job which throws an error with an empty message',
                        schedule: cron => cron.everySaturdayAt(0, 0),
                        async execute(injector) {
                            const error = new EmptyMessageError('');
                            (error as Error & { cause?: unknown }).cause = 'ECONNRESET';
                            throw error;
                        },
                    }),
                    new ScheduledTask({
                        id: 'hold-test-job-blocking',
                        description: 'For testing the hold window blocks scheduled re-execution',
                        schedule: cron => cron.everySaturdayAt(0, 0),
                        async execute(injector) {
                            holdSpyBlocking();
                            return { success: true };
                        },
                    }),
                    new ScheduledTask({
                        id: 'hold-test-job-manual',
                        description: 'For testing that manual triggers bypass the hold window',
                        schedule: cron => cron.everySaturdayAt(0, 0),
                        async execute(injector) {
                            holdSpyManual();
                            return { success: true };
                        },
                    }),
                    new ScheduledTask({
                        id: 'timeout-test-job',
                        description: 'A test job which runs longer than its timeout',
                        schedule: cron => cron.everySaturdayAt(0, 0),
                        timeout: 100,
                        async execute(injector) {
                            timeoutSpy();
                            await timeoutGate.promise;
                            return { success: true };
                        },
                    }),
                    new ScheduledTask({
                        id: 'timeout-reject-test-job',
                        description: 'A test job which rejects after its timeout',
                        schedule: cron => cron.everySaturdayAt(0, 0),
                        timeout: 100,
                        async execute(injector) {
                            await timeoutRejectGate.promise;
                            throw new Error('late failure');
                        },
                    }),
                    new ScheduledTask({
                        id: 'long-run-test-job',
                        description: 'A test job which runs longer than its schedule interval',
                        schedule: cron => cron.everySaturdayAt(0, 0),
                        async execute(injector) {
                            longRunSpy();
                            await longRunGate.promise;
                            return { success: true };
                        },
                    }),
                ],
                runTasksInWorkerOnly: false,
            },
            plugins: [DefaultSchedulerPlugin.init({ manualTriggerCheckInterval: 50 })],
            logger: testingLogger,
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        // We have extra time here because a lot of jobs are
        // triggered from all the product updates
        await awaitRunningJobs(adminClient, 10_000, 1000);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await awaitRunningJobs(adminClient);
        await server.destroy();
    });

    it('get tasks', async () => {
        const { scheduledTasks } = await adminClient.query(getTasksDocument);
        expect(scheduledTasks.length).toBe(7);
        const testJob = scheduledTasks.find(t => t.id === 'test-job');
        if (!testJob) throw new Error('test-job not found');
        expect(testJob.description).toBe("A test job that doesn't do anything");
        expect(testJob.schedule).toBe('0 0 * * 6');
        expect(testJob.scheduleDescription).toBe('At 12:00 AM, only on Saturday');
        expect(testJob.enabled).toBe(true);
    });

    it('disable task', async () => {
        const { updateScheduledTask } = await adminClient.query(updateTaskDocument, {
            input: {
                id: 'test-job',
                enabled: false,
            },
        });
        expect(updateScheduledTask.enabled).toBe(false);
    });

    it('enable task', async () => {
        const { updateScheduledTask } = await adminClient.query(updateTaskDocument, {
            input: {
                id: 'test-job',
                enabled: true,
            },
        });
        expect(updateScheduledTask.enabled).toBe(true);
    });

    it('run task', async () => {
        taskSpy.mockClear();
        expect(taskSpy).toHaveBeenCalledTimes(0);

        const { runScheduledTask } = await adminClient.query(runTaskDocument, { id: 'test-job' });
        expect(runScheduledTask.success).toBe(true);

        await pollUntil(() => taskSpy.mock.calls.length >= 1);
        expect(taskSpy).toHaveBeenCalledTimes(1);
    });

    // OSS-511 — calling `executeTask(...)` directly drives the cron-fed
    // path; manual triggers go through `runManually` (next test).
    it('hold window blocks repeat scheduled execution; clears after the window', async () => {
        const { strategy, task } = getTask(server, 'hold-test-job-blocking');

        holdSpyBlocking.mockClear();

        await strategy.executeTask(task)();
        expect(holdSpyBlocking).toHaveBeenCalledTimes(1);

        // Within the window: blocked.
        await strategy.executeTask(task)();
        expect(holdSpyBlocking).toHaveBeenCalledTimes(1);

        // After the window: runs again.
        await wait(MAX_HOLD_MS + 200);
        await strategy.executeTask(task)();
        expect(holdSpyBlocking).toHaveBeenCalledTimes(2);
    });

    // OSS-511 — manual trigger must run *inside* the window; the control
    // assertion proves the window is genuinely active at that moment.
    it('manual trigger bypasses the hold window (cron path stays blocked)', async () => {
        const { strategy, task } = getTask(server, 'hold-test-job-manual');

        holdSpyManual.mockClear();

        // Arm the hold window.
        await strategy.executeTask(task)();
        expect(holdSpyManual).toHaveBeenCalledTimes(1);

        // Manual trigger inside the window: must run.
        await adminClient.query(runTaskDocument, { id: 'hold-test-job-manual' });
        await wait(300);
        expect(holdSpyManual).toHaveBeenCalledTimes(2);

        // Control: cron path inside the same window must still be blocked.
        await strategy.executeTask(task)();
        expect(holdSpyManual).toHaveBeenCalledTimes(2);
    });

    // #5276
    it('logs the error class and cause when a task throws an empty-message error', async () => {
        testingLogger.errorSpy.mockClear();

        const { strategy, task } = getTask(server, 'error-test-job');
        await strategy.executeTask(task)();

        const call = testingLogger.errorSpy.mock.calls.find((args: any[]) =>
            String(args[0]).includes('Scheduled task "error-test-job" failed'),
        );
        expect(call).toBeDefined();

        const [message, , trace] = call as [string, string | undefined, string | undefined];
        expect(message).toContain('EmptyMessageError');
        expect(message).toContain('ECONNRESET');
        expect(message).toContain('at ');
        expect(trace).toBeUndefined();

        const { scheduledTasks } = await adminClient.query(getTasksDocument);
        const errorTask = scheduledTasks.find(t => t.id === 'error-test-job');
        expect(errorTask?.lastResult).toEqual({ error: 'EmptyMessageError' });
    });

    // #5165: a timed-out task keeps running, so its lock must be held until execute() settles
    it('keeps the lock after a timeout until the task settles', async () => {
        const { strategy, task } = getTask(server, 'timeout-test-job');

        try {
            await strategy.executeTask(task)();
            expect(timeoutSpy).toHaveBeenCalledTimes(1);
            expect(await isRunning('timeout-test-job')).toBe(true);

            // Manual runs skip the hold window, so only the lock can block this one.
            await (strategy as any).runManually(task);
            expect(timeoutSpy).toHaveBeenCalledTimes(1);
        } finally {
            timeoutGate.release();
        }
        await pollUntil(async () => (await isRunning('timeout-test-job')) === false);

        const { scheduledTasks } = await adminClient.query(getTasksDocument);
        expect(scheduledTasks.find(t => t.id === 'timeout-test-job')?.lastResult).toEqual({
            error: 'Task timed out',
        });
    });

    // #5165
    it('releases the lock when a timed-out execution later rejects', async () => {
        const { strategy, task } = getTask(server, 'timeout-reject-test-job');
        testingLogger.errorSpy.mockClear();

        try {
            await strategy.executeTask(task)();
            expect(await isRunning('timeout-reject-test-job')).toBe(true);
        } finally {
            timeoutRejectGate.release();
        }
        await pollUntil(async () => (await isRunning('timeout-reject-test-job')) === false);

        const lateError = testingLogger.errorSpy.mock.calls.find((args: any[]) =>
            String(args[0]).includes('Timed-out scheduled task "timeout-reject-test-job" failed'),
        );
        expect(String(lateError?.[0])).toContain('late failure');

        const { scheduledTasks } = await adminClient.query(getTasksDocument);
        expect(scheduledTasks.find(t => t.id === 'timeout-reject-test-job')?.lastResult).toEqual({
            error: 'Task timed out',
        });
    });

    // #5165, and the stale lock part of #5166 only: a run longer than the schedule interval keeps its lock
    it('blocks a second run while a run outlasts the schedule interval', async () => {
        const { strategy, task } = getTask(server, 'long-run-test-job');
        const staleTaskService = (strategy as any).staleTaskService;
        const getScheduleIntervalMs = staleTaskService.getScheduleIntervalMs.bind(staleTaskService);
        const intervalSpy = vi
            .spyOn(staleTaskService, 'getScheduleIntervalMs')
            .mockImplementation((t: any) => (t.id === task.id ? 300 : getScheduleIntervalMs(t)));
        const acquireSpy = vi.spyOn(strategy as any, 'tryAcquireLock');
        let firstRun: Promise<void> | undefined;

        try {
            firstRun = strategy.executeTask(task)();
            await pollUntil(() => longRunSpy.mock.calls.length === 1);
            // Let several stale thresholds pass while the first run is in flight.
            await wait(1000);
            acquireSpy.mockClear();

            // Manual runs skip the hold window, so only the lock can block this one.
            void (strategy as any).runManually(task);
            await pollUntil(() => acquireSpy.mock.calls.some(([t]: any[]) => t.id === task.id));
            const index = acquireSpy.mock.calls.findIndex(([t]: any[]) => t.id === task.id);
            expect(await acquireSpy.mock.results[index].value).toBeFalsy();
        } finally {
            longRunGate.release();
            await firstRun;
            intervalSpy.mockRestore();
            acquireSpy.mockRestore();
        }
        await pollUntil(async () => (await isRunning('long-run-test-job')) === false);
    });

    async function isRunning(id: string) {
        const { scheduledTasks } = await adminClient.query(getTasksDocument);
        return scheduledTasks.find(t => t.id === id)?.isRunning;
    }
});

function getTask(server: any, id: string) {
    const config = server.app.get(ConfigService);
    const strategy = config.schedulerOptions.schedulerStrategy;
    const task = config.schedulerOptions.tasks?.find((t: ScheduledTask) => t.id === id);
    if (!strategy || !task) throw new Error(`Missing task or strategy for ${id}`);
    return { strategy, task };
}
