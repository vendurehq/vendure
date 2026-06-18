/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { JobListOptions, SortOrder } from '@vendure/common/lib/generated-types';
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
});
