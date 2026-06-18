import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';

import { Job } from '../../../job-queue/job';
import { RequestContext, SerializedRequestContext } from '../../common/request-context';

@Resolver('Job')
export class JobEntityResolver {
    private readonly graphQlMaxInt = 2 ** 31 - 1;

    @ResolveField()
    async duration(@Parent() job: Job) {
        return Math.min(job.duration, this.graphQlMaxInt);
    }

    @ResolveField()
    async data(@Parent() job: Job) {
        const ctx = job.data.ctx;
        if (this.isSerializedRequestContext(ctx)) {
            // The job data includes a serialized RequestContext object
            // This can be very large, so we will manually prune it before
            // returning
            const prunedCtx = {
                ...pick(ctx, [
                    '_apiType',
                    '_languageCode',
                    '_authorizedAsOwnerOnly',
                    '_isAuthorized',
                    '_channel',
                ]),
                _session: ctx._session
                    ? {
                          ...ctx._session,
                          user: ctx._session.user ? omit(ctx._session.user, ['channelPermissions']) : {},
                      }
                    : {},
            };
            job.data.ctx = prunedCtx;
        }
        return job.data;
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
