import { describe, expect, it, vi } from 'vitest';

import { JobQueueStrategy } from '../config/job-queue/job-queue-strategy';

import { Job } from './job';
import { SubscribableJob } from './subscribable-job';

function strategy(): JobQueueStrategy {
    return {
        findOne: vi.fn(),
        findMany: vi.fn(),
        findManyById: vi.fn(),
        removeSettledJobs: vi.fn(),
    } as unknown as JobQueueStrategy;
}

describe('SubscribableJob', () => {
    describe('isBuffered', () => {
        it('defaults to false', () => {
            const job = new Job({ id: 1, queueName: 'test', data: {} });

            expect(new SubscribableJob(job, strategy()).isBuffered).toBe(false);
        });

        it('is true for a placeholder built by the buffered() factory', () => {
            const job = new Job({ id: 'buffered', queueName: 'test', data: {} });

            expect(SubscribableJob.buffered(job, strategy()).isBuffered).toBe(true);
        });
    });
});
