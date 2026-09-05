/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { JobListOptions, JobState, SortOrder } from '@vendure/common/lib/generated-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { InMemoryJobQueueStrategy } from './in-memory-job-queue-strategy';
import { Job } from './job';

describe('InMemoryJobQueueStrategy', () => {
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

    afterEach(async () => {
        strategy.destroy();
    });

    describe('findMany options', () => {
        beforeEach(async () => {
            await strategy.add(
                new Job({
                    id: 'video-1',
                    queueName: 'video',
                    data: {},
                    createdAt: new Date('2020-04-03T10:00:00.000Z'),
                }),
            );
            await strategy.add(
                new Job({
                    id: 'video-2',
                    queueName: 'video',
                    data: {},
                    createdAt: new Date('2020-04-03T10:01:00.000Z'),
                }),
            );
            await strategy.add(
                new Job({
                    id: 'email-1',
                    queueName: 'email',
                    data: {},
                    createdAt: new Date('2020-04-03T10:02:00.000Z'),
                }),
            );
            await strategy.add(
                new Job({
                    id: 'video-3',
                    queueName: 'video',
                    data: {},
                    createdAt: new Date('2020-04-03T10:03:00.000Z'),
                }),
            );
            await strategy.add(
                new Job({
                    id: 'email-2',
                    queueName: 'email',
                    data: {},
                    createdAt: new Date('2020-04-03T10:04:00.000Z'),
                }),
            );
        });

        async function getIdResultsFor(options: JobListOptions): Promise<string[]> {
            const result = await strategy.findMany(options);
            return result.items.map(j => j.id as string);
        }

        it('take & skip', async () => {
            expect(await getIdResultsFor({ take: 1 })).toEqual(['video-1']);
            expect(await getIdResultsFor({ take: 1, skip: 1 })).toEqual(['video-2']);
            expect(await getIdResultsFor({ take: 10, skip: 2 })).toEqual(['email-1', 'video-3', 'email-2']);
        });

        it('sort createdAt', async () => {
            expect(await getIdResultsFor({ sort: { createdAt: SortOrder.DESC } })).toEqual([
                'email-2',
                'video-3',
                'email-1',
                'video-2',
                'video-1',
            ]);
            expect(await getIdResultsFor({ sort: { createdAt: SortOrder.ASC } })).toEqual([
                'video-1',
                'video-2',
                'email-1',
                'video-3',
                'email-2',
            ]);
        });

        it('sort id', async () => {
            expect(await getIdResultsFor({ sort: { id: SortOrder.DESC } })).toEqual([
                'video-3',
                'video-2',
                'video-1',
                'email-2',
                'email-1',
            ]);
            expect(await getIdResultsFor({ sort: { id: SortOrder.ASC } })).toEqual([
                'email-1',
                'email-2',
                'video-1',
                'video-2',
                'video-3',
            ]);
        });

        it('filter queueName', async () => {
            expect(await getIdResultsFor({ filter: { queueName: { eq: 'video' } } })).toEqual([
                'video-1',
                'video-2',
                'video-3',
            ]);

            expect(await getIdResultsFor({ filter: { queueName: { contains: 'vid' } } })).toEqual([
                'video-1',
                'video-2',
                'video-3',
            ]);
        });

        it('filter isSettled', async () => {
            const video1 = await strategy.findOne('video-1');
            video1?.complete();
            await strategy.update(video1!);

            expect(await getIdResultsFor({ filter: { isSettled: { eq: true } } })).toEqual(['video-1']);
        });
    });

    describe('returns snapshots rather than the stored Job instances', () => {
        beforeEach(async () => {
            await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: { foo: 'bar' } }));
        });

        it('findOne returns a new instance on each call', async () => {
            const a = await strategy.findOne('job-1');
            const b = await strategy.findOne('job-1');

            expect(a).toBeDefined();
            expect(b).toBeDefined();
            expect(a).not.toBe(b);
        });

        it('findOne result does not change state after the stored job is started', async () => {
            const beforeStart = await strategy.findOne('job-1');
            expect(beforeStart?.state).toBe(JobState.PENDING);

            const running = await strategy.next('test');
            await strategy.update(running!);

            // The previously-returned job must still describe the state at the time it was read...
            expect(beforeStart?.state).toBe(JobState.PENDING);
            // ...while a fresh read reflects the new state.
            const afterStart = await strategy.findOne('job-1');
            expect(afterStart?.state).toBe(JobState.RUNNING);
            expect(afterStart).not.toBe(beforeStart);
        });

        it('findOne result does not change when the stored job progresses and completes', async () => {
            const running = await strategy.next('test');
            await strategy.update(running!);

            const atStart = await strategy.findOne('job-1');
            expect(atStart?.progress).toBe(0);

            running!.setProgress(50);
            await strategy.update(running!);
            const midway = await strategy.findOne('job-1');

            running!.complete('all done');
            await strategy.update(running!);
            const settled = await strategy.findOne('job-1');

            expect(atStart?.progress).toBe(0);
            expect(atStart?.state).toBe(JobState.RUNNING);
            expect(midway?.progress).toBe(50);
            expect(midway?.state).toBe(JobState.RUNNING);
            expect(settled?.progress).toBe(100);
            expect(settled?.state).toBe(JobState.COMPLETED);
            expect(settled?.result).toBe('all done');
        });

        it('snapshot preserves all job fields', async () => {
            const running = await strategy.next('test');
            running!.setProgress(25);
            await strategy.update(running!);

            const snapshot = await strategy.findOne('job-1');

            expect(snapshot?.id).toBe(running!.id);
            expect(snapshot?.queueName).toBe(running!.queueName);
            expect(snapshot?.data).toEqual({ foo: 'bar' });
            expect(snapshot?.retries).toBe(running!.retries);
            expect(snapshot?.attempts).toBe(running!.attempts);
            expect(snapshot?.state).toBe(running!.state);
            expect(snapshot?.progress).toBe(25);
            expect(snapshot?.createdAt).toEqual(running!.createdAt);
            expect(snapshot?.startedAt).toEqual(running!.startedAt);
            expect(snapshot?.settledAt).toBeUndefined();
            expect(snapshot?.error).toBeUndefined();
        });

        it('snapshot preserves settledAt of a completed job', async () => {
            const running = await strategy.next('test');
            running!.complete('all done');
            await strategy.update(running!);

            const snapshot = await strategy.findOne('job-1');

            expect(snapshot?.state).toBe(JobState.COMPLETED);
            expect(snapshot?.result).toBe('all done');
            expect(snapshot?.settledAt).toBeInstanceOf(Date);
            expect(snapshot?.settledAt).toEqual(running!.settledAt);
            // `isSettled` is derived from settledAt, and `removeSettledJobs()` filters on it,
            // so a snapshot which lost settledAt would silently never be considered settled.
            expect(snapshot?.isSettled).toBe(true);
        });

        it('snapshot preserves settledAt and error of a failed job', async () => {
            const running = await strategy.next('test');
            running!.fail(new Error('it broke'));
            await strategy.update(running!);

            const snapshot = await strategy.findOne('job-1');

            expect(snapshot?.state).toBe(JobState.FAILED);
            expect(snapshot?.error).toBe('it broke');
            expect(snapshot?.settledAt).toBeInstanceOf(Date);
            expect(snapshot?.settledAt).toEqual(running!.settledAt);
            expect(snapshot?.isSettled).toBe(true);
        });

        it('findMany and findManyById return new instances', async () => {
            const fromFindMany = (await strategy.findMany()).items.find(j => j.id === 'job-1');
            const fromFindManyById = (await strategy.findManyById(['job-1']))[0];
            const fromFindOne = await strategy.findOne('job-1');

            expect(fromFindMany).toBeDefined();
            expect(fromFindManyById).toBeDefined();
            expect(fromFindMany).not.toBe(fromFindManyById);
            expect(fromFindMany).not.toBe(fromFindOne);
            expect(fromFindManyById).not.toBe(fromFindOne);
        });

        it('mutating a returned job does not affect the stored job', async () => {
            const snapshot = await strategy.findOne('job-1');
            snapshot!.complete('not persisted');

            expect((await strategy.findOne('job-1'))?.state).toBe(JobState.PENDING);
        });

        it('cancelling a job which is still PENDING prevents it from being run', async () => {
            const job = await strategy.findOne('job-1');
            job!.cancel();
            await strategy.update(job!);

            expect((await strategy.findOne('job-1'))?.state).toBe(JobState.CANCELLED);
            expect(await strategy.next('test')).toBeUndefined();
            expect((await strategy.findOne('job-1'))?.state).toBe(JobState.CANCELLED);
        });

        it('updating a PENDING job twice does not duplicate its queue entry', async () => {
            const job = await strategy.findOne('job-1');
            await strategy.update(job!);
            await strategy.update(job!);

            expect(await strategy.next('test')).toBeDefined();
            expect(await strategy.next('test')).toBeUndefined();
        });
    });

    describe('cancelJob', () => {
        beforeEach(async () => {
            await strategy.add(new Job({ id: 'job-1', queueName: 'test', data: {} }));
        });

        it('cancels the live instance held by the processing loop', async () => {
            const running = await strategy.next('test');
            await strategy.update(running!);

            const cancelled = await strategy.cancelJob('job-1');

            // `ActiveQueue` keeps the instance returned by `next()` and its `process()` function
            // reads `job.state` to decide whether to abort. A cancellation which only reaches a
            // snapshot never gets there, so the running job carries on to completion.
            expect(running!.state).toBe(JobState.CANCELLED);
            expect(cancelled?.state).toBe(JobState.CANCELLED);
            // The returned value is still a snapshot, not the live instance.
            expect(cancelled).not.toBe(running);
            expect((await strategy.findOne('job-1'))?.state).toBe(JobState.CANCELLED);
        });

        it('is not overwritten by a subsequent progress update from the running job', async () => {
            const running = await strategy.next('test');
            await strategy.update(running!);
            // This is the listener `ActiveQueue` registers on the live job for the duration of
            // the run: every `setProgress()` writes the live job back into the store.
            running!.on('progress', job => void strategy.update(job));

            await strategy.cancelJob('job-1');
            running!.setProgress(50);

            expect((await strategy.findOne('job-1'))?.state).toBe(JobState.CANCELLED);
        });

        it('returns undefined for an unknown job', async () => {
            expect(await strategy.cancelJob('no-such-job')).toBeUndefined();
        });
    });
});
