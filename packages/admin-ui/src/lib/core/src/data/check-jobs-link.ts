import { Injector } from '@angular/core';
import { ApolloLink, Operation } from '@apollo/client/core';

import { JobQueueService } from '../providers/job-queue/job-queue.service';

/**
 * This link checks each operation and if it is a mutation, it tells the JobQueueService
 * to poll for active jobs. This is because certain mutations trigger background jobs
 * which should be made known in the UI.
 */
export class CheckJobsLink extends ApolloLink {
    private _jobQueueService: JobQueueService;
    get jobQueueService(): JobQueueService {
        if (!this._jobQueueService) {
            this._jobQueueService = this.injector.get(JobQueueService);
        }
        return this._jobQueueService;
    }

    /**
     * We inject the Injector rather than the JobQueueService directly in order
     * to avoid a circular dependency error.
     */
    constructor(private injector: Injector) {
        super((operation, forward) => {
            if (this.isMutation(operation)) {
                this.jobQueueService.checkForJobs();
            }
            return forward ? forward(operation) : null;
        });
    }

    private isMutation(operation: Operation): boolean {
        return !!operation.query.definitions.find(
            d => d.kind === 'OperationDefinition' && d.operation === 'mutation',
        );
    }
}
