import { Injectable, OnModuleInit } from '@nestjs/common';
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { JobQueue, JobQueueService, Logger, PluginCommonModule, VendurePlugin } from '@vendure/core';
import gql from 'graphql-tag';

@Injectable()
class TestQueueService implements OnModuleInit {
    private jobQueue: JobQueue<{ message: string }>;

    constructor(private jobQueueService: JobQueueService) {}

    async onModuleInit() {
        this.jobQueue = await this.jobQueueService.createQueue({
            name: 'test-queue',
            process: async job => {
                // Process the job here
                Logger.info(`Processing job with message: ${job.data.message}`, 'TestQueueService');
                if (Math.random() < 0.2) {
                    throw new Error('Random failure occurred while processing job');
                }
                return { processed: true, message: job.data.message };
            },
        });
    }

    addJob(message: string) {
        return this.jobQueue.add({ message });
    }

    async generateJobs(count: number) {
        const jobs = [];
        for (let i = 0; i < count; i++) {
            jobs.push(this.addJob(`Test job ${i + 1}`));
            // await new Promise(resolve => setTimeout(resolve, 100));
        }
        return Promise.all(jobs);
    }
}

@Resolver()
class TestQueueResolver {
    constructor(private testQueueService: TestQueueService) {}

    @Mutation()
    async generateTestJobs(@Args() args: { jobCount: number }) {
        const jobs = await this.testQueueService.generateJobs(args.jobCount);
        return {
            success: true,
            jobCount: jobs.length,
        };
    }
}

/**
 * This plugin can create a large number of jobs in the job queue, which we
 * can then use to stress test the job queue's ability to return lists of jobs.
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [TestQueueService],
    adminApiExtensions: {
        schema: gql`
            extend type Mutation {
                generateTestJobs(jobCount: Int!): GenerateTestJobsResult!
            }

            type GenerateTestJobsResult {
                success: Boolean!
                jobCount: Int!
            }
        `,
        resolvers: [TestQueueResolver],
    },
})
export class JobQueueStressTestPlugin {}
