import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { forkJoin } from 'rxjs';

import { ConfigService } from '../../../config/config.service';
import { isInspectableJobQueueStrategy } from '../../../config/job-queue/inspectable-job-queue-strategy';
import { Logger } from '../../../config/logger/vendure-logger';
import { JobQueueService } from '../../../job-queue/job-queue.service';
import { SubscribableJob } from '../../../job-queue/subscribable-job';
import { BUFFER_SEARCH_INDEX_UPDATES } from '../constants';

import { CollectionJobBuffer } from './collection-job-buffer';
import { SearchIndexJobBuffer } from './search-index-job-buffer';

@Injectable()
export class SearchJobBufferService implements OnApplicationBootstrap {
    readonly searchIndexJobBuffer = new SearchIndexJobBuffer();
    readonly collectionJobBuffer = new CollectionJobBuffer();

    constructor(
        private jobQueueService: JobQueueService,
        private configService: ConfigService,
        @Inject(BUFFER_SEARCH_INDEX_UPDATES) private bufferUpdates: boolean,
    ) {}

    onApplicationBootstrap(): any {
        if (this.bufferUpdates === true) {
            this.jobQueueService.addBuffer(this.searchIndexJobBuffer);
            this.jobQueueService.addBuffer(this.collectionJobBuffer);
        }
    }

    async getPendingSearchUpdates(): Promise<number> {
        if (!this.bufferUpdates) {
            return 0;
        }
        const bufferSizes = await this.jobQueueService.bufferSize(
            this.searchIndexJobBuffer,
            this.collectionJobBuffer,
        );
        return (
            (bufferSizes[this.searchIndexJobBuffer.id] ?? 0) + (bufferSizes[this.collectionJobBuffer.id] ?? 0)
        );
    }

    async runPendingSearchUpdates(): Promise<void> {
        if (!this.bufferUpdates) {
            return;
        }
        const { jobQueueStrategy } = this.configService.jobQueueOptions;

        const collectionFilterJobs = await this.jobQueueService.flush(this.collectionJobBuffer);
        if (collectionFilterJobs.length && isInspectableJobQueueStrategy(jobQueueStrategy)) {
            const subscribableCollectionJobs = collectionFilterJobs.map(
                job => new SubscribableJob(job, jobQueueStrategy),
            );
            await forkJoin(
                ...subscribableCollectionJobs.map(sj =>
                    sj.updates({ pollInterval: 500, timeoutMs: 15 * 60 * 1000 }),
                ),
            )
                .toPromise()
                .catch(err => {
                    Logger.error(err.message);
                });
        }
        await this.jobQueueService.flush(this.searchIndexJobBuffer);
    }
}
