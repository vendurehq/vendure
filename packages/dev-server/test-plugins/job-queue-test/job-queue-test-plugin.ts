import { Injectable, OnModuleInit } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { JobState } from '@vendure/common/lib/generated-types';
import { JobQueue, JobQueueService, Logger, PluginCommonModule, VendurePlugin } from '@vendure/core';
import { gql } from 'graphql-tag';
import { forkJoin, Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

interface TaskConfigInput {
    intervalMs: number;
    shouldFail: boolean;
    retries: number;
    subscribeToResult: boolean;
}

let queueCount = 1;

@Injectable()
export class JobQueueTestService implements OnModuleInit {
    private queues: Array<JobQueue<{ intervalMs: number; shouldFail: boolean }>> = [];

    constructor(private jobQueueService: JobQueueService) {}

    async onModuleInit() {
        for (let i = 0; i < queueCount; i++) {
            const queue: JobQueue<{
                intervalMs: number;
                shouldFail: boolean;
            }> = await this.jobQueueService.createQueue({
                name: `test-queue-${i + 1}`,
                process: async job => {
                    Logger.info(`Starting job ${job.id}, shouldFail: ${JSON.stringify(job.data.shouldFail)}`);
                    let progress = 0;
                    while (progress < 100) {
                        // Logger.info(`Job ${job.id} progress: ${progress}`);
                        await new Promise(resolve => setTimeout(resolve, job.data.intervalMs));
                        progress += 10;
                        job.setProgress(progress);
                        if (progress > 70 && job.data.shouldFail) {
                            Logger.warn(`Job ${job.id} will fail`);
                            throw new Error(`Job failed!!`);
                        }
                    }
                    Logger.info(`Completed job ${job.id}`);
                    return 'Done!';
                },
            });
            this.queues.push(queue);
        }
    }

    async startTask(input: TaskConfigInput) {
        const { intervalMs, shouldFail, subscribeToResult, retries } = input;
        const updates: Array<Observable<number>> = [];
        for (const queue of this.queues) {
            const job = await queue.add({ intervalMs, shouldFail }, { retries });
            if (subscribeToResult) {
                updates.push(
                    job.updates().pipe(
                        map(update => {
                            Logger.info(`Job ${update.id}: progress: ${update.progress}`);
                            if (update.state === JobState.COMPLETED) {
                                Logger.info(`COMPLETED: ${JSON.stringify(update.result, null, 2)}`);
                                return update.result;
                            }
                            return update.progress;
                        }),
                        catchError(err => of(err.message)),
                    ),
                );
            }
        }
        if (subscribeToResult) {
            return forkJoin(...updates);
        } else {
            return 'running in background';
        }
    }
}

@Resolver()
export class JobQueueTestResolver {
    constructor(private service: JobQueueTestService) {}

    @Mutation()
    startTask(@Args() args: any) {
        return this.service.startTask(args.input);
    }
}

/**
 * A plugin which can be used to test job queue strategies. Exposes a mutation `startTask` in
 * the Admin API which triggers a job.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        resolvers: [JobQueueTestResolver],
        schema: gql`
            input TaskConfigInput {
                intervalMs: Int!
                shouldFail: Boolean!
                retries: Int
                subscribeToResult: Boolean
            }
            extend type Mutation {
                startTask(input: TaskConfigInput!): JSON!
            }
        `,
    },
    providers: [JobQueueTestService],
})
export class JobQueueTestPlugin {
    static init(options: { queueCount: number }) {
        queueCount = options.queueCount;
        return this;
    }
}
