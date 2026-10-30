/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { JobState } from '@vendure/common/lib/generated-types';
import { lastValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JobQueueStrategy } from '../config/job-queue/job-queue-strategy';
import { Logger } from '../config/logger/vendure-logger';

import { InMemoryJobQueueStrategy } from './in-memory-job-queue-strategy';
import { Job } from './job';
import { SubscribableJob } from './subscribable-job';

// `updates()` clamps the poll interval to a minimum of 50ms, so use that value directly —
// anything lower would make the `sleep()` calls below shorter than the actual poll period.
const pollInterval = 50;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const TIMEOUT_RESULT = 'Job subscription timed out. The job may still be running';

/**
 * Returns a fresh Job instance with the same values, mirroring the way a real strategy
 * hydrates a new entity on each `findOne()` call.
 */
function snapshot(job: Job): Job {
    return new Job({
        id: job.id,
        queueName: job.queueName,
        data: job.data,
        state: job.state,
        progress: job.progress,
        result: job.result,
        error: job.error,
        retries: job.retries,
        attempts: job.attempts,
    });
}

/**
 * A minimal inspectable strategy backed by a single mutable Job instance, so that a test
 * can drive the job through its states by hand.
 */
function setup() {
    const job = new Job({ id: 1, queueName: 'test', data: {} });
    const findOne = vi.fn().mockImplementation(() => Promise.resolve(snapshot(job)));
    const strategy = {
        findOne,
        findMany: vi.fn(),
        findManyById: vi.fn(),
        removeSettledJobs: vi.fn(),
    } as unknown as JobQueueStrategy;
    return { job, findOne, subscribableJob: new SubscribableJob(job, strategy) };
}

describe('SubscribableJob', () => {
    describe('updates() with the InMemoryJobQueueStrategy', () => {
        let strategy: InMemoryJobQueueStrategy;

        beforeEach(() => {
            strategy = new InMemoryJobQueueStrategy();
            // init with mock injector & ProcessContext
            strategy.init({
                get() {
                    return { isWorker: false };
                },
            } as any);
        });

        afterEach(() => {
            strategy.destroy();
        });

        it('emits the terminal update when the job completes', async () => {
            const job = await strategy.add(new Job({ queueName: 'test', data: {} }));
            const subscribableJob = new SubscribableJob(job, strategy);

            const collected = lastValueFrom(subscribableJob.updates({ pollInterval }).pipe(toArray()));

            // Drive the job through the strategy the way the JobQueue would.
            const running = await strategy.next('test');
            await strategy.update(running!);
            await sleep(pollInterval * 3);

            running!.setProgress(50);
            await strategy.update(running!);
            await sleep(pollInterval * 3);

            running!.complete('the result');
            await strategy.update(running!);

            const updates = await collected;
            const final = updates[updates.length - 1];

            expect(final.state).toBe(JobState.COMPLETED);
            expect(final.progress).toBe(100);
            expect(final.result).toBe('the result');
        }, 10_000);

        it('emits intermediate progress updates', async () => {
            const job = await strategy.add(new Job({ queueName: 'test', data: {} }));
            const subscribableJob = new SubscribableJob(job, strategy);

            const collected = lastValueFrom(subscribableJob.updates({ pollInterval }).pipe(toArray()));

            const running = await strategy.next('test');
            await strategy.update(running!);
            await sleep(pollInterval * 3);

            running!.setProgress(33);
            await strategy.update(running!);
            await sleep(pollInterval * 3);

            running!.setProgress(66);
            await strategy.update(running!);
            await sleep(pollInterval * 3);

            running!.complete('done');
            await strategy.update(running!);

            const updates = await collected;

            expect(updates.map(u => u.progress)).toEqual([0, 33, 66, 100]);
            expect(updates.map(u => u.state)).toEqual([
                JobState.RUNNING,
                JobState.RUNNING,
                JobState.RUNNING,
                JobState.COMPLETED,
            ]);
        }, 10_000);

        it('emits the terminal update when the job fails', async () => {
            const job = await strategy.add(new Job({ queueName: 'test', data: {} }));
            const subscribableJob = new SubscribableJob(job, strategy);

            const collected = lastValueFrom(
                subscribableJob.updates({ pollInterval, errorOnFail: false }).pipe(toArray()),
            );

            const running = await strategy.next('test');
            await strategy.update(running!);
            await sleep(pollInterval * 3);

            running!.fail(new Error('it broke'));
            await strategy.update(running!);

            const updates = await collected;
            const final = updates[updates.length - 1];

            expect(final.state).toBe(JobState.FAILED);
            expect(final.error).toBe('it broke');
        }, 10_000);
    });

    describe('updates() timeout', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it('emits updates until the job settles', async () => {
            const { job, subscribableJob } = setup();
            job.start();

            const result = lastValueFrom(
                subscribableJob.updates({ pollInterval, timeoutMs: 5000 }).pipe(toArray()),
            );
            await vi.advanceTimersByTimeAsync(50);
            job.complete('job result');
            await vi.advanceTimersByTimeAsync(50);
            const updates = await result;

            expect(updates.map(u => u.state)).toEqual([JobState.RUNNING, JobState.COMPLETED]);
            expect(updates[updates.length - 1].result).toBe('job result');
        });

        it('times out after timeoutMs even once updates have been emitted', async () => {
            const { job, subscribableJob } = setup();
            job.start();
            const logError = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);

            let settled = false;
            const result = lastValueFrom(
                subscribableJob.updates({ pollInterval, timeoutMs: 200 }).pipe(toArray()),
            ).finally(() => (settled = true));
            await vi.advanceTimersByTimeAsync(199);
            expect(settled).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            expect(settled).toBe(true);
            const updates = await result;

            expect(updates.map(u => u.state)).toEqual([JobState.RUNNING, JobState.RUNNING]);
            expect(updates[0].result).toBeUndefined();
            expect(updates[1].result).toBe(TIMEOUT_RESULT);
            expect(logError).toHaveBeenCalledTimes(1);
            expect(logError).toHaveBeenCalledWith(
                'Job 1 SubscribableJob update polling timed out after 200ms. The job may still be running.',
            );
        });

        it('times out when the job never emits any update at all', async () => {
            const { findOne, subscribableJob } = setup();
            findOne.mockImplementation(() => Promise.resolve(undefined));

            const result = lastValueFrom(
                subscribableJob.updates({ pollInterval, timeoutMs: 200 }).pipe(toArray()),
            );
            await vi.advanceTimersByTimeAsync(200);
            const updates = await result;

            expect(updates.length).toBe(1);
            expect(updates[0].result).toBe(TIMEOUT_RESULT);
        });

        it('stops polling once the timeout has elapsed', async () => {
            const { job, findOne, subscribableJob } = setup();
            job.start();

            const result = lastValueFrom(
                subscribableJob.updates({ pollInterval, timeoutMs: 200 }).pipe(toArray()),
            );
            await vi.advanceTimersByTimeAsync(200);
            await result;
            const callsWhenTimedOut = findOne.mock.calls.length;

            await vi.advanceTimersByTimeAsync(500);

            expect(findOne.mock.calls.length).toBe(callsWhenTimedOut);
        });

        it('errors on a failed job when errorOnFail is not disabled', async () => {
            const { job, subscribableJob } = setup();
            job.start();

            const assertion = expect(
                lastValueFrom(subscribableJob.updates({ pollInterval, timeoutMs: 5000 }).pipe(toArray())),
            ).rejects.toThrowError('job failed');
            await vi.advanceTimersByTimeAsync(50);
            job.fail(new Error('job failed'));
            await vi.advanceTimersByTimeAsync(50);
            await assertion;
        });
    });
});
