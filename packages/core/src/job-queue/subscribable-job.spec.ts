/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { JobState } from '@vendure/common/lib/generated-types';
import { lastValueFrom } from 'rxjs';
import { toArray } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryJobQueueStrategy } from './in-memory-job-queue-strategy';
import { Job } from './job';
import { SubscribableJob } from './subscribable-job';

// `updates()` clamps the poll interval to a minimum of 50ms, so use that value directly —
// anything lower would make the `sleep()` calls below shorter than the actual poll period.
const pollInterval = 50;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe('SubscribableJob', () => {
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

    describe('updates() with the InMemoryJobQueueStrategy', () => {
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
});
