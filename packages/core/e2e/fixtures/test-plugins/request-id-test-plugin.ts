import { Controller, Get, OnModuleInit } from '@nestjs/common';
import {
    Ctx,
    getRequestId,
    JobQueue,
    JobQueueService,
    Logger,
    PluginCommonModule,
    RequestContext,
    VendurePlugin,
} from '@vendure/core';

export const REQUEST_ID_TEST_LOGGER_CTX = 'RequestIdTest';

export interface ProcessedRequestIdJob {
    jobId: string;
    jobRequestId: string | undefined;
    currentRequestId: string | undefined;
    ctxRequestId: string | undefined;
}

@Controller('request-id-test')
class RequestIdTestController implements OnModuleInit {
    private queue: JobQueue<{ ctx: any }>;
    private failingQueue: JobQueue<{ reason: string }>;

    constructor(private jobQueueService: JobQueueService) {}

    async onModuleInit() {
        this.queue = await this.jobQueueService.createQueue({
            name: 'request-id-test',
            process: async job => {
                // A timer, so that the ID is read after an asynchronous step.
                await new Promise(resolve => setTimeout(resolve, 10));
                Logger.info(`Processing job ${String(job.id)}`, REQUEST_ID_TEST_LOGGER_CTX);
                RequestIdTestPlugin.processedJobs.push({
                    jobId: String(job.id),
                    jobRequestId: job.requestId,
                    currentRequestId: getRequestId(),
                    ctxRequestId: RequestContext.deserialize(job.data.ctx).requestId,
                });
            },
        });
        this.failingQueue = await this.jobQueueService.createQueue({
            name: 'request-id-test-failing',
            process: async job => {
                await new Promise(resolve => setTimeout(resolve, 10));
                throw new Error(job.data.reason);
            },
        });
    }

    @Get('failing-job')
    async addFailingJob() {
        const job = await this.failingQueue.add({ reason: 'The job failed on purpose' });
        return { jobId: String(job.id) };
    }

    @Get()
    async handle(@Ctx() ctx: RequestContext) {
        Logger.info('Handling the request', REQUEST_ID_TEST_LOGGER_CTX);
        const job = await this.queue.add({ ctx: ctx.serialize() });
        return { ctxRequestId: ctx.requestId, jobId: String(job.id) };
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [RequestIdTestController],
})
export class RequestIdTestPlugin {
    static processedJobs: ProcessedRequestIdJob[] = [];
}
