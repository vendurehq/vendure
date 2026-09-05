import { JobState } from '@vendure/common/lib/generated-types';
import { lastValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobQueueStrategy } from '../config/job-queue/job-queue-strategy';
import { Logger } from '../config/logger/vendure-logger';

import { Job } from './job';
import { SubscribableJob } from './subscribable-job';

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

function tick(ms: number): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

describe('SubscribableJob', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('updates()', () => {
        it('emits updates until the job settles', async () => {
            const { job, subscribableJob } = setup();
            job.start();
            setTimeout(() => job.complete('job result'), 60);

            const startedAt = Date.now();
            const updates = await lastValueFrom(
                subscribableJob.updates({ pollInterval: 20, timeoutMs: 5000 }).pipe(toArray()),
            );

            expect(updates.map(u => u.state)).toEqual([JobState.RUNNING, JobState.COMPLETED]);
            expect(updates[updates.length - 1].result).toBe('job result');
            // The stream must complete as soon as the job settles rather than hanging
            // around until `timeoutMs` elapses.
            expect(Date.now() - startedAt).toBeLessThan(2000);
        });

        it('times out after timeoutMs even once updates have been emitted', async () => {
            // Without a total-wait bound this test hangs: the job emits a RUNNING update
            // and then never settles, so the stream never completes.
            const { job, subscribableJob } = setup();
            job.start();
            const logError = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);

            const startedAt = Date.now();
            const updates = await lastValueFrom(
                subscribableJob.updates({ pollInterval: 20, timeoutMs: 200 }).pipe(toArray()),
            );
            const elapsed = Date.now() - startedAt;

            expect(updates.map(u => u.state)).toEqual([JobState.RUNNING, JobState.RUNNING]);
            expect(updates[0].result).toBeUndefined();
            expect(updates[1].result).toBe(TIMEOUT_RESULT);
            expect(elapsed).toBeGreaterThanOrEqual(190);
            expect(elapsed).toBeLessThan(2000);
            // The timeout still logs exactly what it logged before this fix.
            expect(logError).toHaveBeenCalledTimes(1);
            expect(logError).toHaveBeenCalledWith(
                'Job 1 SubscribableJob update polling timed out after 200ms. The job may still be running.',
            );
        });

        it('times out when the job never emits any update at all', async () => {
            const { findOne, subscribableJob } = setup();
            findOne.mockImplementation(() => Promise.resolve(undefined));

            const updates = await lastValueFrom(
                subscribableJob.updates({ pollInterval: 20, timeoutMs: 200 }).pipe(toArray()),
            );

            expect(updates.length).toBe(1);
            expect(updates[0].result).toBe(TIMEOUT_RESULT);
        });

        it('stops polling once the timeout has elapsed', async () => {
            const { job, findOne, subscribableJob } = setup();
            job.start();

            await lastValueFrom(
                subscribableJob.updates({ pollInterval: 20, timeoutMs: 200 }).pipe(toArray()),
            );
            const callsWhenTimedOut = findOne.mock.calls.length;

            await tick(200);

            expect(findOne.mock.calls.length).toBe(callsWhenTimedOut);
        });

        it('errors on a failed job when errorOnFail is not disabled', async () => {
            const { job, subscribableJob } = setup();
            job.start();
            setTimeout(() => job.fail(new Error('job failed')), 60);

            await expect(
                lastValueFrom(subscribableJob.updates({ pollInterval: 20, timeoutMs: 5000 }).pipe(toArray())),
            ).rejects.toThrowError('job failed');
        });
    });
});
