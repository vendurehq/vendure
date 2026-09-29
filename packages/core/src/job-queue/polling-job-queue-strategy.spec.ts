import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InMemoryJobQueueStrategy } from './in-memory-job-queue-strategy';
import { Job } from './job';

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
        vi.useRealTimers();
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

    it('backs off up to maxIdlePollInterval while idle, and resets once a job is found', async () => {
        strategy = new InMemoryJobQueueStrategy({
            concurrency: 1,
            pollInterval: 10,
            maxIdlePollInterval: 80,
        });
        strategy.init({ get: () => ({ isWorker: false }) } as any);
        vi.useFakeTimers();
        const next = vi.spyOn(strategy, 'next');
        const processed: string[] = [];
        const process = async (job: Job) => {
            processed.push(job.id as string);
        };
        activeProcess = process;
        await strategy.start('test', process);

        // Without the backoff this is ~40 polls: 10ms, then 20, 40, 80, 80, ...
        await vi.advanceTimersByTimeAsync(400);
        expect(next.mock.calls.length).toBeLessThan(12);

        await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
        for (let i = 0; i < 100 && !processed.length; i++) {
            await vi.advanceTimersByTimeAsync(1);
        }
        expect(processed).toEqual(['job-1']);
        const callsAfterJob = next.mock.calls.length;
        // Reset to pollInterval, so the next polls come at +10ms and +30ms rather than +80ms.
        await vi.advanceTimersByTimeAsync(35);
        expect(next.mock.calls.length).toBeGreaterThanOrEqual(callsAfterJob + 2);
    });

    it('does not back off when one concurrency slot finds a job and another does not', async () => {
        strategy = new InMemoryJobQueueStrategy({
            concurrency: 2,
            pollInterval: 10,
            maxIdlePollInterval: 80,
        });
        strategy.init({ get: () => ({ isWorker: false }) } as any);
        vi.useFakeTimers();
        let calls = 0;
        let lastCallAt = 0;
        // The first slot of each round finds a job and the second finds nothing. Calls in
        // the same round are well under 5ms apart; rounds are at least pollInterval apart.
        vi.spyOn(strategy, 'next').mockImplementation(async () => {
            calls++;
            const newRound = Date.now() - lastCallAt > 5;
            lastCallAt = Date.now();
            return newRound ? new Job({ id: `job-${calls}`, queueName: 'test', data: {} }) : undefined;
        });
        vi.spyOn(strategy, 'update').mockResolvedValue(undefined);
        const process = async () => undefined;
        activeProcess = process;
        await strategy.start('test', process);

        await vi.advanceTimersByTimeAsync(300);

        // At 10ms per round this is ~50 calls; backing off to 80ms would give ~12.
        expect(calls).toBeGreaterThan(25);
    });
});
