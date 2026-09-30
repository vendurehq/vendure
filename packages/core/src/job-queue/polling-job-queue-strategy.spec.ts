import { JobState } from '@vendure/common/lib/generated-types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryJobQueueStrategy } from './in-memory-job-queue-strategy';
import { Job } from './job';
import { PollingJobQueueStrategy } from './polling-job-queue-strategy';

describe('PollingJobQueueStrategy', () => {
    let strategy: InMemoryJobQueueStrategy;

    beforeEach(() => {
        strategy = new InMemoryJobQueueStrategy({ concurrency: 1, pollInterval: 10 });
        strategy.init({
            get() {
                return { isWorker: false };
            },
        } as any);
    });

    let activeProcess: ((job: Job) => Promise<any>) | undefined;

    afterEach(async () => {
        // strategy.destroy() does not touch the ActiveQueue timer, so without
        // an explicit stop() the polling loop keeps running against a
        // torn-down mock in the next test. Calling stop() here — rather than
        // at the end of each test body — means it still runs even when the
        // test fails on an assertion or a waitFor timeout above it.
        if (activeProcess) {
            await strategy.stop('test', activeProcess);
            activeProcess = undefined;
        }
        strategy.destroy();
    });

    it('releases the concurrency slot even when the settling update() throws', async () => {
        const originalUpdate = strategy.update.bind(strategy);
        vi.spyOn(strategy, 'update').mockImplementation(async (job: Job) => {
            if (job.id === 'job-1' && job.isSettled) {
                // Simulate the settling update for the first job failing,
                // e.g. a transient DB error.
                throw new Error('simulated update failure');
            }
            return originalUpdate(job);
        });

        await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
        await strategy.add(new Job({ id: 'job-2', queueName: 'test', data: {} }));

        const processed: string[] = [];
        const process = async (job: Job) => {
            processed.push(job.id as string);
            return true;
        };
        activeProcess = process;
        await strategy.start('test', process);

        await vi.waitFor(
            () => {
                expect(processed).toEqual(['job-1', 'job-2']);
            },
            { timeout: 2000, interval: 20 },
        );
    });

    it('releases the concurrency slot even when the initial (pre-process) update() throws', async () => {
        const originalUpdate = strategy.update.bind(strategy);
        let updateCallCount = 0;
        vi.spyOn(strategy, 'update').mockImplementation(async (job: Job) => {
            updateCallCount++;
            if (updateCallCount === 1) {
                // Simulate the initial "mark as running" update for the first
                // job failing before process() ever runs.
                throw new Error('simulated update failure');
            }
            return originalUpdate(job);
        });

        await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
        await strategy.add(new Job({ id: 'job-2', queueName: 'test', data: {} }));

        const processed: string[] = [];
        const process = async (job: Job) => {
            processed.push(job.id as string);
            return true;
        };
        activeProcess = process;
        await strategy.start('test', process);

        await vi.waitFor(
            () => {
                expect(processed).toEqual(['job-2']);
            },
            { timeout: 2000, interval: 20 },
        );
    });

    it('keeps an in-flight initial update visible to shutdown, so stop() waits for it', async () => {
        let releaseUpdate: (() => void) | undefined;
        const updateGate = new Promise<void>(resolve => {
            releaseUpdate = resolve;
        });
        const originalUpdate = strategy.update.bind(strategy);
        let sawInitialUpdate = false;
        vi.spyOn(strategy, 'update').mockImplementation(async (job: Job) => {
            if (job.id === 'job-1' && !job.isSettled && !sawInitialUpdate) {
                // Simulate a slow initial "mark as running" update, e.g. a slow
                // DB write, so there is a real window between next() resolving
                // and the job being marked active.
                sawInitialUpdate = true;
                await updateGate;
            }
            return originalUpdate(job);
        });

        await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));

        const processed: string[] = [];
        const process = async (job: Job) => {
            processed.push(job.id as string);
            return true;
        };
        activeProcess = process;
        await strategy.start('test', process);

        await vi.waitFor(() => expect(sawInitialUpdate).toBe(true), { timeout: 2000, interval: 10 });

        // If the job isn't tracked as active yet, stop() would see zero active
        // jobs and resolve immediately, letting shutdown continue before the
        // job is ever processed.
        const stopPromise = strategy.stop('test', process);
        activeProcess = undefined;
        releaseUpdate?.();
        await stopPromise;

        expect(processed).toEqual(['job-1']);
    });

    // #5440 — a job cancelled while running stays CANCELLED whatever its process function returns
    it.each([
        ['undefined', undefined],
        ['a string', 'done'],
        ['an object', { processed: 3 }],
    ])('keeps a job cancelled while running as CANCELLED when process returns %s', async (_, returnValue) => {
        let releaseProcess: (() => void) | undefined;
        const processGate = new Promise<void>(resolve => {
            releaseProcess = resolve;
        });
        let runningJob: Job | undefined;
        const process = async (job: Job) => {
            runningJob = job;
            await processGate;
            return returnValue;
        };

        let released = false;
        const updatesAfterRelease: Job[] = [];
        const originalUpdate = strategy.update.bind(strategy);
        vi.spyOn(strategy, 'update').mockImplementation(async (job: Job) => {
            if (released && job === runningJob) {
                updatesAfterRelease.push(job);
            }
            return originalUpdate(job);
        });

        await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
        activeProcess = process;
        await strategy.start('test', process);
        await vi.waitFor(() => expect(runningJob).toBeDefined(), { timeout: 2000, interval: 10 });

        // The inherited cancelJob() cancels a stored copy, as the SQL strategy does, so only
        // the ActiveQueue cancellation poll can reach the running job.
        await PollingJobQueueStrategy.prototype.cancelJob.call(strategy, 'job-1');
        await vi.waitFor(() => expect(runningJob?.state).toBe(JobState.CANCELLED), {
            timeout: 2000,
            interval: 10,
        });

        released = true;
        releaseProcess?.();
        // Wait for the settling write so the assertion cannot read the store before it.
        await vi.waitFor(() => expect(updatesAfterRelease.length).toBe(1), { timeout: 2000, interval: 10 });

        const settled = await strategy.findOne('job-1');
        expect(settled?.state).toBe(JobState.CANCELLED);
    });

    // #5440
    it('keeps a job cancelled while running as CANCELLED when process returns a non-Job value', async () => {
        await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));

        const process = async (job: Job) => {
            await strategy.cancelJob(job.id as string);
            await vi.waitFor(() => expect(job.state).toBe(JobState.CANCELLED), {
                timeout: 2000,
                interval: 10,
            });
            return 'done';
        };
        activeProcess = process;
        await strategy.start('test', process);

        await vi.waitFor(
            async () => {
                const job = await strategy.findOne('job-1');
                expect(job?.isSettled).toBe(true);
                expect(job?.state).toBe(JobState.CANCELLED);
            },
            { timeout: 2000, interval: 20 },
        );
    });
});
