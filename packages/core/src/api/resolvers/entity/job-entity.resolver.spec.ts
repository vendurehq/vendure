import { JobState } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { Job } from '../../../job-queue/job';

import { JobEntityResolver } from './job-entity.resolver';

describe('JobEntityResolver', () => {
    const resolver = new JobEntityResolver();

    function createJobWithLegacyContext() {
        return new Job({
            queueName: 'test',
            state: JobState.COMPLETED,
            data: {
                ctx: {
                    _apiType: 'admin',
                    _channel: { id: 1, code: '__default_channel__' },
                    _languageCode: 'en',
                    _isAuthorized: true,
                    _authorizedAsOwnerOnly: false,
                    _session: {
                        id: 1,
                        token: 'legacy-session-token',
                        user: { id: 1, identifier: 'superadmin', channelPermissions: [] },
                    },
                    _req: { headers: { authorization: 'Bearer legacy-session-token' } },
                },
            },
        });
    }

    // Job data written before GHSA-32jm-mf7r-7qw5 was fixed still holds a token and the
    // raw request, so the resolver prunes both rather than trusting the stored data.
    it('strips the session token and the raw request from a legacy context', async () => {
        const result: any = await resolver.data(createJobWithLegacyContext());

        expect(result.ctx._session.token).toBeUndefined();
        expect(result.ctx._req).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('legacy-session-token');
    });

    // InMemoryJobQueueStrategy hands out the live Job objects, so pruning must not mutate
    // the job, or a job which has not been processed yet loses its context.
    it('does not mutate the job data', async () => {
        const job = createJobWithLegacyContext();

        await resolver.data(job);

        expect(job.data.ctx._session.token).toBe('legacy-session-token');
        expect(job.data.ctx._req).toBeDefined();
    });

    it('returns the data untouched when it holds no serialized context', async () => {
        const job = new Job({ queueName: 'test', state: JobState.COMPLETED, data: { foo: 'bar' } });

        expect(await resolver.data(job)).toEqual({ foo: 'bar' });
    });

    it('tolerates job data being null', async () => {
        const job = new Job({ queueName: 'test', state: JobState.COMPLETED, data: null as any });

        expect(await resolver.data(job)).toBeNull();
    });
});
