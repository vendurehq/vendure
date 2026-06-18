import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobQueue as GraphQlJobQueue } from '@vendure/common/lib/generated-types';

import { Instrument } from '../common';
import { ConfigService, JobQueueStrategy, Logger } from '../config';

import { loggerCtx } from './constants';
import { Job } from './job';
import { JobBuffer } from './job-buffer/job-buffer';
import { JobBufferService } from './job-buffer/job-buffer.service';
import { JobQueue } from './job-queue';
import { CreateQueueOptions, JobData } from './types';

/**
 * @description
 * The JobQueueService is used to create new {@link JobQueue} instances and access
 * existing jobs.
 *
 * @example
 * ```ts
 * // A service which transcodes video files
 * class VideoTranscoderService {
 *
 *   private jobQueue: JobQueue<{ videoId: string; }>;
 *
 *   async onModuleInit() {
 *     // The JobQueue is created on initialization
 *     this.jobQueue = await this.jobQueueService.createQueue({
 *       name: 'transcode-video',
 *       process: async job => {
 *         return await this.transcodeVideo(job.data.videoId);
 *       },
 *     });
 *   }
 *
 *   addToTranscodeQueue(videoId: string) {
 *     this.jobQueue.add({ videoId, })
 *   }
 *
 *   private async transcodeVideo(videoId: string) {
 *     // e.g. call some external transcoding service
 *   }
 *
 * }
 * ```
 *
 * @docsCategory JobQueue
 */
@Injectable()
@Instrument()
export class JobQueueService implements OnModuleDestroy {
    private queues: Array<JobQueue<any>> = [];
    private hasStarted = false;

    /**
     * @description
     * Returns `true` if the job queues have been started.
     */
    get started(): boolean {
        return this.hasStarted;
    }

    private get jobQueueStrategy(): JobQueueStrategy {
        return this.configService.jobQueueOptions.jobQueueStrategy;
    }

    constructor(
        private configService: ConfigService,
        private jobBufferService: JobBufferService,
    ) {}

    /** @internal */
    onModuleDestroy() {
        this.hasStarted = false;
        return Promise.all(this.queues.map(q => q.stop()));
    }

    /**
     * @description
     * Configures and creates a new {@link JobQueue} instance.
     */
    async createQueue<Data extends JobData<Data>>(
        options: CreateQueueOptions<Data>,
    ): Promise<JobQueue<Data>> {
        if (this.configService.jobQueueOptions.prefix) {
            options = { ...options, name: `${this.configService.jobQueueOptions.prefix}${options.name}` };
        }
        const wrappedProcessFn = this.createWrappedProcessFn(options.process);
        options = { ...options, process: wrappedProcessFn };

        const queue = new JobQueue(options, this.jobQueueStrategy, this.jobBufferService);
        if (this.hasStarted && this.shouldStartQueue(queue.name)) {
            await queue.start();
        }
        this.queues.push(queue);

        return queue;
    }

    async start(): Promise<void> {
        this.hasStarted = true;
        for (const queue of this.queues) {
            if (!queue.started && this.shouldStartQueue(queue.name)) {
                Logger.info(`Starting queue: ${queue.name}`, loggerCtx);
                await queue.start();
            }
        }
    }

    /**
     * @description
     * Adds a {@link JobBuffer}, which will make it active and begin collecting
     * jobs to buffer.
     *
     * @since 1.3.0
     */
    addBuffer(buffer: JobBuffer<any>) {
        this.jobBufferService.addBuffer(buffer);
    }

    /**
     * @description
     * Removes a {@link JobBuffer}, prevent it from collecting and buffering any
     * subsequent jobs.
     *
     * @since 1.3.0
     */
    removeBuffer(buffer: JobBuffer<any>) {
        this.jobBufferService.removeBuffer(buffer);
    }

    /**
     * @description
     * Returns an object containing the number of buffered jobs arranged by bufferId. This
     * can be used to decide whether a particular buffer has any jobs to flush.
     *
     * Passing in JobBuffer instances _or_ ids limits the results to the specified JobBuffers.
     * If no argument is passed, sizes will be returned for _all_ JobBuffers.
     *
     * @example
     * ```ts
     * const sizes = await this.jobQueueService.bufferSize('buffer-1', 'buffer-2');
     *
     * // sizes = { 'buffer-1': 12, 'buffer-2': 3 }
     * ```
     *
     * @since 1.3.0
     */
    bufferSize(...forBuffers: Array<JobBuffer<any> | string>): Promise<{ [bufferId: string]: number }> {
        return this.jobBufferService.bufferSize(forBuffers);
    }

    /**
     * @description
     * Flushes the specified buffers, which means that the buffer is cleared and the jobs get
     * sent to the job queue for processing. Before sending the jobs to the job queue,
     * they will be passed through each JobBuffer's `reduce()` method, which is can be used
     * to optimize the amount of work to be done by e.g. de-duplicating identical jobs or
     * aggregating data over the collected jobs.
     *
     * Passing in JobBuffer instances _or_ ids limits the action to the specified JobBuffers.
     * If no argument is passed, _all_ JobBuffers will be flushed.
     *
     * Returns an array of all Jobs which were added to the job queue.
     *
     * @since 1.3.0
     */
    flush(...forBuffers: Array<JobBuffer<any> | string>): Promise<Job[]> {
        return this.jobBufferService.flush(forBuffers);
    }

    /**
     * @description
     * Returns an array of `{ name: string; running: boolean; }` for each
     * registered JobQueue.
     */
    getJobQueues(): GraphQlJobQueue[] {
        return this.queues.map(queue => ({
            name: queue.name,
            running: queue.started,
        }));
    }

    /**
     * We wrap the process function in order to catch any errors thrown and pass them to
     * any configured ErrorHandlerStrategies.
     */
    private createWrappedProcessFn<Data extends JobData<Data>>(
        processFn: (job: Job<Data>) => Promise<any>,
    ): (job: Job<Data>) => Promise<any> {
        const { errorHandlers } = this.configService.systemOptions;
        return async (job: Job<Data>) => {
            try {
                return await processFn(job);
            } catch (e) {
                for (const handler of errorHandlers) {
                    if (e instanceof Error) {
                        void handler.handleWorkerError(e, { job });
                    }
                }
                throw e;
            }
        };
    }

    private shouldStartQueue(queueName: string): boolean {
        if (this.configService.jobQueueOptions.activeQueues.length > 0) {
            if (!this.configService.jobQueueOptions.activeQueues.includes(queueName)) {
                return false;
            }
        }

        return true;
    }
}
