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

    // #4949 — a job claimed by an in-flight next() must not be left RUNNING by shutdown
    it('waits for a job claimed by an in-flight next() before stop() resolves', async () => {
        let releaseNext: (() => void) | undefined;
        const nextGate = new Promise<void>(resolve => {
            releaseNext = resolve;
        });
        const originalNext = strategy.next.bind(strategy);
        let sawNext = false;
        vi.spyOn(strategy, 'next').mockImplementation(async (queueName: string) => {
            if (!sawNext) {
                // Simulate a slow claim: the SQL strategy marks the row RUNNING inside next(),
                // so the job is already taken before ActiveQueue knows about it.
                sawNext = true;
                await nextGate;
            }
            return originalNext(queueName);
        });

        let releaseProcess: (() => void) | undefined;
        const processGate = new Promise<void>(resolve => {
            releaseProcess = resolve;
        });
        const process = async () => {
            await processGate;
            return true;
        };

        await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
        activeProcess = process;
        let stopPromise: Promise<unknown> | undefined;
        try {
            await strategy.start('test', process);
            await vi.waitFor(() => expect(sawNext).toBe(true), { timeout: 2000, interval: 10 });

            let stopped = false;
            stopPromise = strategy.stop('test', process).then(() => (stopped = true));
            activeProcess = undefined;
            releaseNext?.();

            // stop() always sleeps 1s before resolving, so wait past that to prove it is
            // still waiting on the claimed job rather than on its own delay.
            await new Promise(resolve => setTimeout(resolve, 1200));
            expect(stopped).toBe(false);
        } finally {
            // Release both gates even when an assertion above fails, so stop() is not
            // left waiting out its 20s timeout in the background.
            releaseNext?.();
            releaseProcess?.();
        }
        await stopPromise;
        const settled = await strategy.findOne('job-1');
        expect(settled?.state).toBe(JobState.COMPLETED);
    });

    // #4949 — once stop() is called, the polling loop must not claim further jobs
    it('does not claim more jobs after stop() lands during an in-flight next()', async () => {
        const concurrentStrategy = new InMemoryJobQueueStrategy({ concurrency: 2, pollInterval: 10 });
        concurrentStrategy.init({ get: () => ({ isWorker: false }) } as any);
        let releaseNext: (() => void) | undefined;
        const nextGate = new Promise<void>(resolve => {
            releaseNext = resolve;
        });
        const originalNext = concurrentStrategy.next.bind(concurrentStrategy);
        let sawNext = false;
        vi.spyOn(concurrentStrategy, 'next').mockImplementation(async (queueName: string) => {
            if (!sawNext) {
                sawNext = true;
                await nextGate;
            }
            return originalNext(queueName);
        });

        await concurrentStrategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
        await concurrentStrategy.add(new Job({ id: 'job-2', queueName: 'test', data: {} }));
        const processed: string[] = [];
        const process = async (job: Job) => {
            processed.push(job.id as string);
            return true;
        };
        let stopPromise: Promise<void> | undefined;
        try {
            await concurrentStrategy.start('test', process);
            await vi.waitFor(() => expect(sawNext).toBe(true), { timeout: 2000, interval: 10 });

            stopPromise = concurrentStrategy.stop('test', process);
            releaseNext?.();
            await stopPromise;

            expect(processed).toEqual(['job-1']);
            expect((await concurrentStrategy.findOne('job-2'))?.state).toBe(JobState.PENDING);
        } finally {
            // This strategy is not covered by afterEach, so stop its polling loop here
            // even when the waitFor above times out.
            releaseNext?.();
            await (stopPromise ?? concurrentStrategy.stop('test', process));
            concurrentStrategy.destroy();
        }
    });

    // #4949 — a claim still in flight when the graceful shutdown times out must not start the job
    it.each([
        ['next() claim', 'next'],
        ['initial update()', 'update'],
    ] as const)(
        'defers a job whose %s outlasts the graceful shutdown timeout instead of running it',
        async (_label, slowMethod) => {
            const shortTimeoutStrategy = new InMemoryJobQueueStrategy({
                concurrency: 1,
                pollInterval: 10,
                gracefulShutdownTimeout: 100,
            });
            shortTimeoutStrategy.init({ get: () => ({ isWorker: false }) } as any);
            let releaseGate: (() => void) | undefined;
            const gate = new Promise<void>(resolve => {
                releaseGate = resolve;
            });
            let sawSlowCall = false;
            if (slowMethod === 'next') {
                const originalNext = shortTimeoutStrategy.next.bind(shortTimeoutStrategy);
                vi.spyOn(shortTimeoutStrategy, 'next').mockImplementation(async (queueName: string) => {
                    if (!sawSlowCall) {
                        sawSlowCall = true;
                        await gate;
                    }
                    return originalNext(queueName);
                });
            }
            // Record every state the queue persists for the job, so the assertion waits for the
            // queue to actually act on the claimed job rather than reading it before it is claimed.
            const persistedStates: JobState[] = [];
            const originalUpdate = shortTimeoutStrategy.update.bind(shortTimeoutStrategy);
            vi.spyOn(shortTimeoutStrategy, 'update').mockImplementation(async (job: Job) => {
                if (slowMethod === 'update' && !job.isSettled && !sawSlowCall) {
                    sawSlowCall = true;
                    await gate;
                }
                await originalUpdate(job);
                persistedStates.push(job.state);
            });

            await shortTimeoutStrategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
            const processed: string[] = [];
            const process = async (job: Job) => {
                processed.push(job.id as string);
                return true;
            };
            try {
                await shortTimeoutStrategy.start('test', process);
                await vi.waitFor(() => expect(sawSlowCall).toBe(true), { timeout: 2000, interval: 10 });

                // stop() gives up after 100ms and resolves while the slow call is still pending.
                await shortTimeoutStrategy.stop('test', process);
                releaseGate?.();

                await vi.waitFor(
                    () =>
                        expect(
                            persistedStates.some(
                                state => state === JobState.PENDING || state === JobState.COMPLETED,
                            ),
                        ).toBe(true),
                    { timeout: 2000, interval: 10 },
                );
                expect(persistedStates).not.toContain(JobState.COMPLETED);
                expect((await shortTimeoutStrategy.findOne('job-1'))?.state).toBe(JobState.PENDING);
                expect(processed).toEqual([]);
            } finally {
                releaseGate?.();
                shortTimeoutStrategy.destroy();
            }
        },
    );

    // #4949 — a forced stop landing just after the initial update must still keep the job from completing
    it.each([0, 1, 2, 3, 4])(
        'defers the job when a forced stop lands %i microtasks after its initial update',
        async depth => {
            // A negative timeout makes stop() force the stop synchronously on its first poll.
            const forcedStrategy = new InMemoryJobQueueStrategy({
                concurrency: 1,
                pollInterval: 10,
                gracefulShutdownTimeout: -1,
            });
            forcedStrategy.init({ get: () => ({ isWorker: false }) } as any);
            const process = async () => {
                await new Promise(resolve => setTimeout(resolve, 50));
                return true;
            };
            let stopPromise: Promise<void> | undefined;
            const originalUpdate = forcedStrategy.update.bind(forcedStrategy);
            vi.spyOn(forcedStrategy, 'update').mockImplementation(async (job: Job) => {
                await originalUpdate(job);
                if (!stopPromise && job.state === JobState.RUNNING) {
                    let delay = Promise.resolve();
                    for (let i = 0; i < depth; i++) {
                        delay = delay.then(() => undefined);
                    }
                    stopPromise = delay.then(() => forcedStrategy.stop('test', process));
                }
            });
            try {
                await forcedStrategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
                await forcedStrategy.start('test', process);
                await vi.waitFor(() => expect(stopPromise).toBeDefined(), { timeout: 2000, interval: 5 });
                await stopPromise;

                expect((await forcedStrategy.findOne('job-1'))?.state).toBe(JobState.PENDING);
            } finally {
                forcedStrategy.destroy();
            }
        },
    );

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
