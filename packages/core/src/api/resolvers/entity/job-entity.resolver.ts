import { Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { omit } from '@vendure/common/lib/omit';
import { pick } from '@vendure/common/lib/pick';
import { isObject } from '@vendure/common/lib/shared-utils';

import { Job } from '../../../job-queue/job';
import { redactJobData } from '../../../job-queue/redact-job-data';
import { SerializedRequestContext } from '../../common/request-context';

@Resolver('Job')
export class JobEntityResolver {
    private readonly graphQlMaxInt = 2 ** 31 - 1;

    @ResolveField()
    async duration(@Parent() job: Job) {
        return Math.min(job.duration, this.graphQlMaxInt);
    }

    /**
     * Job data is returned to every administrator who can read jobs, SuperAdmin included, so
     * credentials are redacted from it. A copy is returned rather than
     * mutating job.data, because a JobQueueStrategy may hand out the live Job objects which the
     * worker processes, and mutating them would change the data of a job not yet processed.
     */
    @ResolveField()
    async data(@Parent() job: Job) {
        const data: unknown = job.data;
        if (!isObject(data)) {
            return redactJobData(data);
        }
        const copy: Record<string, any> = { ...data };
        const ctx = copy.ctx;
        if (this.isSerializedRequestContext(ctx)) {
            // The job data includes a serialized RequestContext object
            // This can be very large, so we will manually prune it before
            // returning.
            // The session token is never returned over the API (GHSA-32jm-mf7r-7qw5).
            const session = ctx._session as Record<string, any> | undefined;
            copy.ctx = {
                ...pick(ctx, ['_apiType', '_languageCode', '_authorizedAsOwnerOnly', '_isAuthorized']),
                // Only the identifying fields: the full Channel can carry custom fields which
                // are restricted by permission or internal.
                _channel: ctx._channel ? pick(ctx._channel, ['id', 'code', 'token']) : {},
                _session: session
                    ? {
                          ...omit(session, ['token']),
                          user: session.user ? omit(session.user, ['channelPermissions']) : {},
                      }
                    : {},
            };
        }
        return redactJobData(copy);
    }

    @ResolveField()
    async result(@Parent() job: Job) {
        return redactJobData(job.result);
    }

    @ResolveField()
    async error(@Parent() job: Job) {
        return redactJobData(job.error);
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
