import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import {
    JobQueue,
    MutationCancelJobArgs,
    MutationFlushBufferedJobsArgs,
    MutationRemoveSettledJobsArgs,
    Permission,
    QueryJobArgs,
    QueryJobBufferSizeArgs,
    QueryJobsArgs,
    QueryJobsByIdArgs,
} from '@vendure/common/lib/generated-types';

import { ConfigService, InspectableJobQueueStrategy, isInspectableJobQueueStrategy } from '../../../config';
import { JobQueueService } from '../../../job-queue';
import { JobBufferService } from '../../../job-queue/job-buffer/job-buffer.service';
import { Allow } from '../../decorators/allow.decorator';

@Resolver()
export class JobResolver {
    constructor(
        private configService: ConfigService,
        private jobService: JobQueueService,
        private jobBufferService: JobBufferService,
    ) {}

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadSystem)
    async job(@Args() args: QueryJobArgs) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return;
        }
        return strategy.findOne(args.jobId);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadSystem)
    async jobs(@Args() args: QueryJobsArgs) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return {
                items: [],
                totalItems: 0,
            };
        }
        return strategy.findMany(args.options || undefined);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadSystem)
    async jobsById(@Args() args: QueryJobsByIdArgs) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return [];
        }
        return strategy.findManyById(args.jobIds || undefined);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadSystem)
    jobQueues(): JobQueue[] {
        return this.jobService.getJobQueues();
    }

    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteSystem)
    async removeSettledJobs(@Args() args: MutationRemoveSettledJobsArgs) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return 0;
        }
        return strategy.removeSettledJobs(args.queueNames || [], args.olderThan);
    }

    @Mutation()
    @Allow(Permission.DeleteSettings, Permission.DeleteSystem)
    async cancelJob(@Args() args: MutationCancelJobArgs) {
        const strategy = this.requireInspectableJobQueueStrategy();
        if (!strategy) {
            return;
        }
        return strategy.cancelJob(args.jobId);
    }

    @Query()
    @Allow(Permission.ReadSettings, Permission.ReadSystem)
    async jobBufferSize(@Args() args: QueryJobBufferSizeArgs) {
        const bufferSizes = await this.jobBufferService.bufferSize(args.bufferIds);
        return Object.entries(bufferSizes).map(([bufferId, size]) => ({ bufferId, size }));
    }

    @Mutation()
    @Allow(Permission.UpdateSettings, Permission.UpdateSystem)
    async flushBufferedJobs(@Args() args: MutationFlushBufferedJobsArgs) {
        await this.jobBufferService.flush(args.bufferIds);
        return { success: true };
    }

    private requireInspectableJobQueueStrategy(): InspectableJobQueueStrategy | undefined {
        if (!isInspectableJobQueueStrategy(this.configService.jobQueueOptions.jobQueueStrategy)) {
            return;
        }

        return this.configService.jobQueueOptions.jobQueueStrategy;
    }
}
