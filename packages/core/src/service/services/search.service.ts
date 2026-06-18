import { Injectable } from '@nestjs/common';
import { JobState } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../api/common/request-context';
import { Logger } from '../../config/logger/vendure-logger';
import { Job } from '../../job-queue/job';

/**
 * @description
 * This service allows a concrete search service to override its behaviour
 * by passing itself to the `adopt()` method.
 *
 * @docsCategory services
 */
@Injectable()
export class SearchService {
    private override: Pick<SearchService, 'reindex'> | undefined;

    /**
     * @description
     * Adopt a concrete search service implementation to pass through the
     * calls to.
     */
    adopt(override: Pick<SearchService, 'reindex'>) {
        this.override = override;
    }

    async reindex(ctx: RequestContext): Promise<Job> {
        if (this.override) {
            return this.override.reindex(ctx);
        }
        if (!process.env.CI) {
            Logger.warn('The SearchService should be overridden by an appropriate search plugin.');
        }
        return new Job({
            queueName: 'error',
            data: {},
            id: 'error',
            state: JobState.FAILED,
            progress: 0,
        });
    }
}
