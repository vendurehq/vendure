import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';

import { Job } from '../../../job-queue/job';
import { SerializedRequestContext } from '../../common/request-context';

@Resolver('Job')
export class JobEntityResolver {
    private readonly graphQlMaxInt = 2 ** 31 - 1;

    @ResolveField()
    async duration(@Parent() job: Job) {
        return Math.min(job.duration, this.graphQlMaxInt);
    }

    @ResolveField()
    async data(@Parent() job: Job) {
        const ctx = job.data?.ctx;
        if (!this.isSerializedRequestContext(ctx)) {
            return job.data;
        }
        // The job data includes a serialized RequestContext object
        // This can be very large, so we will manually prune it before
        // returning.
        // The session token is stripped here as well as in RequestContext.serialize(),
        // because job records written before GHSA-32jm-mf7r-7qw5 was fixed still hold one.
        const session = ctx._session as Record<string, any> | undefined;
        const prunedCtx = {
            ...pick(ctx, [
                '_apiType',
                '_languageCode',
                '_authorizedAsOwnerOnly',
                '_isAuthorized',
                '_channel',
            ]),
            _session: session
                ? {
                      ...omit(session, ['token']),
                      user: session.user ? omit(session.user, ['channelPermissions']) : {},
                  }
                : {},
        };
        // A copy is returned rather than mutating job.data, because the
        // InMemoryJobQueueStrategy hands out the live Job objects, so mutating here would
        // strip the context from a job which has not been processed yet.
        return { ...job.data, ctx: prunedCtx };
    }

    private isSerializedRequestContext(input: unknown): input is SerializedRequestContext {
        if (typeof input !== 'object' || input == null) {
            return false;
        }
        return (
            typeof input === 'object' &&
            input.hasOwnProperty('_apiType') &&
            input.hasOwnProperty('_channel') &&
            input.hasOwnProperty('_languageCode')
        );
    }
}
