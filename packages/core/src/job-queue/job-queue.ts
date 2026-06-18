import { Instrument } from '../common';
import { JobQueueStrategy } from '../config';

import { Job } from './job';
import { JobBufferService } from './job-buffer/job-buffer.service';
import { SubscribableJob } from './subscribable-job';
import { CreateQueueOptions, JobData, JobOptions } from './types';

/**
 * @description
 * A JobQueue is used to process {@link Job}s. A job is added to the queue via the
 * `.add()` method, and the configured {@link JobQueueStrategy} will check for new jobs and process each
 * according to the defined `process` function.
 *
 * *Note*: JobQueue instances should not be directly instantiated. Rather, the
 * {@link JobQueueService} `createQueue()` method should be used (see that service
 * for example usage).
 *
 * @docsCategory JobQueue
 */
@Instrument()
export class JobQueue<Data extends JobData<Data> = object> {
    private running = false;

    get name(): string {
        return this.options.name;
    }

    get started(): boolean {
        return this.running;
    }

    constructor(
        private options: CreateQueueOptions<Data>,
        private jobQueueStrategy: JobQueueStrategy,
        private jobBufferService: JobBufferService,
    ) {}

    /** @internal */
    async start() {
        if (this.running) {
            return;
        }
        this.running = true;
        await this.jobQueueStrategy.start<Data>(this.options.name, this.options.process);
    }

    /** @internal */
    async stop(): Promise<void> {
        if (!this.running) {
            return;
        }
        this.running = false;
        return this.jobQueueStrategy.stop(this.options.name, this.options.process);
    }

    /**
     * @description
     * Adds a new {@link Job} to the queue. The resolved {@link SubscribableJob} allows the
     * calling code to subscribe to updates to the Job:
     *
     * @example
     * ```ts
     * const job = await this.myQueue.add({ intervalMs, shouldFail }, { retries: 2 });
     * return job.updates().pipe(
     *   map(update => {
     *     // The returned Observable will emit a value for every update to the job
     *     // such as when the `progress` or `status` value changes.
     *     Logger.info(`Job ${update.id}: progress: ${update.progress}`);
     *     if (update.state === JobState.COMPLETED) {
     *       Logger.info(`COMPLETED ${update.id}: ${update.result}`);
     *     }
     *     return update.result;
     *   }),
     *   catchError(err => of(err.message)),
     * );
     * ```
     *
     * Alternatively, if you aren't interested in the intermediate
     * `progress` changes, you can convert to a Promise like this:
     *
     * @example
     * ```ts
     * const job = await this.myQueue.add({ intervalMs, shouldFail }, { retries: 2 });
     * return job.updates().toPromise()
     *   .then(update => update.result),
     *   .catch(err => err.message);
     * ```
     */
    async add(data: Data, options?: JobOptions<Data>): Promise<SubscribableJob<Data>> {
        const job = new Job<any>({
            data,
            queueName: this.options.name,
            retries: options?.retries ?? 0,
        });

        const isBuffered = await this.jobBufferService.add(job);
        if (!isBuffered) {
            const addedJob = await this.jobQueueStrategy.add(job, options);
            return new SubscribableJob(addedJob, this.jobQueueStrategy);
        } else {
            const bufferedJob = new Job({
                ...job,
                data: job.data,
                id: 'buffered',
            });
            return new SubscribableJob(bufferedJob, this.jobQueueStrategy);
        }
    }
}
