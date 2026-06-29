import { ConfigService, DefaultSchedulerPlugin, mergeConfig, ScheduledTask } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { getTasksDocument, runTaskDocument, updateTaskDocument } from './graphql/shared-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

// Mirrors DEFAULT_MAX_LOCK_HOLD_MS in default-scheduler-plugin/constants.ts.
const MAX_HOLD_MS = 5_000;

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Default scheduler plugin', () => {
    const taskSpy = vi.fn();
    // One task per hold-window test so DB state can't leak between them.
    const holdSpyBlocking = vi.fn();
    const holdSpyManual = vi.fn();

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
                ],
                runTasksInWorkerOnly: false,
            },
            plugins: [DefaultSchedulerPlugin.init({ manualTriggerCheckInterval: 50 })],
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
        expect(scheduledTasks.length).toBe(3);
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

        await new Promise(resolve => setTimeout(resolve, 100));
        expect(taskSpy).toHaveBeenCalledTimes(1);
    });

    // OSS-511 — calling `executeTask(...)` directly drives the cron-fed
    // path; manual triggers go through `runManually` (next test).
    it('hold window blocks repeat scheduled execution; clears after the window', async () => {
        const { strategy, task } = getHoldTask(server, 'hold-test-job-blocking');

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
        const { strategy, task } = getHoldTask(server, 'hold-test-job-manual');

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
});

function getHoldTask(server: any, id: string) {
    const config = server.app.get(ConfigService);
    const strategy = config.schedulerOptions.schedulerStrategy;
    const task = config.schedulerOptions.tasks?.find((t: ScheduledTask) => t.id === id);
    if (!strategy || !task) throw new Error(`Missing task or strategy for ${id}`);
    return { strategy, task };
}
