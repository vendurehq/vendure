import { JobState } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { isObject } from '@vendure/common/lib/shared-utils';
import { from, interval, race, Subject, Subscription } from 'rxjs';
import { filter, switchMap, take, throttleTime } from 'rxjs/operators';

import { Logger } from '../config/logger/vendure-logger';

import { InjectableJobQueueStrategy } from './injectable-job-queue-strategy';
import { Job } from './job';
import { QueueNameProcessStorage } from './queue-name-process-storage';
import { JobData } from './types';

/**
 * @description
 * Defines the backoff strategy used when retrying failed jobs. Returns the delay in
 * ms that should pass before the failed job is retried.
 *
 * @docsCategory JobQueue
 * @docsPage types
 */
export type BackoffStrategy = (queueName: string, attemptsMade: number, job: Job) => number;

export interface PollingJobQueueStrategyConfig {
    /**
     * @description
     * How many jobs from a given queue to process concurrently.
     *
     * Can be set to a function which receives the queue name and returns
     * the concurrency limit. This is useful for limiting concurrency on
     * queues which have resource-intensive jobs.
     *
     * @example
     * ```ts
     * concurrency: (queueName) => {
     *   if (queueName === 'apply-collection-filters') {
     *     return 1;
     *   }
     *   return 3;
     * }
     * ```
     *
     * @default 1
     */
    concurrency?: number | ((queueName: string) => number);
    /**
     * @description
     * The interval in ms between polling the database for new jobs.
     *
     * @description 200
     */
    pollInterval?: number | ((queueName: string) => number);
    /**
     * @description
     * When a job is added to the JobQueue using `JobQueue.add()`, the calling
     * code may specify the number of retries in case of failure. This option allows
     * you to override that number and specify your own number of retries based on
     * the job being added.
     */
    setRetries?: (queueName: string, job: Job) => number;
    /**
     * @description
     * The strategy used to decide how long to wait before retrying a failed job.
     *
     * @default () => 1000
     */
    backoffStrategy?: BackoffStrategy;
    /**
     * @description
     * The timeout in ms which the queue will use when attempting a graceful shutdown.
     * That means, when the server is shut down but a job is running, the job queue will
     * wait for the job to complete before allowing the server to shut down. If the job
     * does not complete within this timeout window, the job will be forced to stop
     * and the server will shut down anyway.
     *
     * @since 2.2.0
     * @default 20_000
     */
    gracefulShutdownTimeout?: number;
}

const STOP_SIGNAL = Symbol('STOP_SIGNAL');

class ActiveQueue<Data extends JobData<Data> = object> {
    private timer: any;
    private running = false;
    private activeJobs: Array<Job<Data>> = [];

    private errorNotifier$ = new Subject<[string, string]>();
    private queueStopped$ = new Subject<typeof STOP_SIGNAL>();
    private subscription: Subscription;
    private readonly pollInterval: number;
    private readonly concurrency: number;

    constructor(
        private readonly queueName: string,
        private readonly process: (job: Job<Data>) => Promise<any>,
        private readonly jobQueueStrategy: PollingJobQueueStrategy,
    ) {
        this.pollInterval =
            typeof this.jobQueueStrategy.pollInterval === 'function'
                ? this.jobQueueStrategy.pollInterval(queueName)
                : this.jobQueueStrategy.pollInterval;
        this.concurrency =
            typeof this.jobQueueStrategy.concurrency === 'function'
                ? this.jobQueueStrategy.concurrency(queueName)
                : this.jobQueueStrategy.concurrency;
    }

    start() {
        Logger.debug(`Starting JobQueue "${this.queueName}"`);
        this.subscription = this.errorNotifier$.pipe(throttleTime(3000)).subscribe(([message, stack]) => {
            Logger.error(message);
            Logger.debug(stack);
        });
        this.running = true;
        const runNextJobs = async () => {
            try {
                const runningJobsCount = this.activeJobs.length;
                for (let i = runningJobsCount; i < this.concurrency; i++) {
                    const nextJob = await this.jobQueueStrategy.next(this.queueName);
                    if (nextJob) {
                        this.activeJobs.push(nextJob);
                        await this.jobQueueStrategy.update(nextJob);
                        const onProgress = (job: Job) => this.jobQueueStrategy.update(job);
                        nextJob.on('progress', onProgress);
                        const cancellationSub = interval(this.pollInterval * 5)
                            .pipe(
                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                switchMap(() => this.jobQueueStrategy.findOne(nextJob.id!)),
                                filter(job => job?.state === JobState.CANCELLED),
                                take(1),
                            )
                            .subscribe(() => {
                                nextJob.cancel();
                            });
                        const stopSignal$ = this.queueStopped$.pipe(take(1));

                        race(from(this.process(nextJob)), stopSignal$)
                            .toPromise()
                            .then(
                                result => {
                                    if (result === STOP_SIGNAL) {
                                        nextJob.defer();
                                    } else if (result instanceof Job && result.state === JobState.CANCELLED) {
                                        nextJob.cancel();
                                    } else {
                                        nextJob.complete(result);
                                    }
                                },
                                err => {
                                    nextJob.fail(err);
                                },
                            )
                            .finally(() => {
                                // if (!this.running && nextJob.state !== JobState.PENDING) {
                                //     return;
                                // }
                                nextJob.off('progress', onProgress);
                                cancellationSub.unsubscribe();
                                return this.onFailOrComplete(nextJob);
                            })
                            .catch((err: any) => {
                                Logger.warn(`Error updating job info: ${JSON.stringify(err)}`);
                            });
                    }
                }
            } catch (e: any) {
                this.errorNotifier$.next([
                    `Job queue "${
                        this.queueName
                    }" encountered an error (set log level to Debug for trace): ${JSON.stringify(e.message)}`,
                    e.stack,
                ]);
            }
            if (this.running) {
                this.timer = setTimeout(runNextJobs, this.pollInterval);
            }
        };

        void runNextJobs();
    }

    async stop(stopActiveQueueTimeout = 20_000): Promise<void> {
        this.running = false;
        clearTimeout(this.timer);
        await this.awaitRunningJobsOrTimeout(stopActiveQueueTimeout);
        Logger.info(`Stopped queue: ${this.queueName}`);
        this.subscription.unsubscribe();
        // Allow any job status changes to be persisted
        // before we permit the application shutdown to continue.
        // Otherwise, the DB connection will close before our
        // changes are persisted.
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    private awaitRunningJobsOrTimeout(stopActiveQueueTimeout = 20_000): Promise<void> {
        const start = +new Date();
        let timeout: ReturnType<typeof setTimeout>;
        return new Promise(resolve => {
            let lastStatusUpdate = +new Date();
            const pollActiveJobs = () => {
                const now = +new Date();
                const timedOut =
                    stopActiveQueueTimeout === undefined ? false : now - start > stopActiveQueueTimeout;

                if (this.activeJobs.length === 0) {
                    clearTimeout(timeout);
                    resolve();
                    return;
                }

                if (timedOut) {
                    Logger.warn(
                        `Timed out (${stopActiveQueueTimeout}ms) waiting for ` +
                            `${this.activeJobs.length} active jobs in queue "${this.queueName}" ` +
                            `to complete. Forcing stop...`,
                    );
                    this.queueStopped$.next(STOP_SIGNAL);
                    clearTimeout(timeout);
                    resolve();
                    return;
                }

                if (this.activeJobs.length > 0) {
                    if (now - lastStatusUpdate > 2000) {
                        Logger.info(
                            `Stopping queue: ${this.queueName} - waiting for ${this.activeJobs.length} active jobs to complete...`,
                        );
                        lastStatusUpdate = now;
                    }
                }

                timeout = setTimeout(pollActiveJobs, 200);
            };
            void pollActiveJobs();
        });
    }

    private async onFailOrComplete(job: Job<Data>) {
        await this.jobQueueStrategy.update(job);
        this.removeJobFromActive(job);
    }

    private removeJobFromActive(job: Job<Data>) {
        const index = this.activeJobs.indexOf(job);
        if (index !== -1) {
            this.activeJobs.splice(index, 1);
        }
    }
}

/**
 * @description
 * This class allows easier implementation of {@link JobQueueStrategy} in a polling style.
 * Instead of providing {@link JobQueueStrategy} `start()` you should provide a `next` method.
 *
 * This class should be extended by any strategy which does not support a push-based system
 * to notify on new jobs. It is used by the {@link SqlJobQueueStrategy} and {@link InMemoryJobQueueStrategy}.
 *
 * @docsCategory JobQueue
 */
export abstract class PollingJobQueueStrategy extends InjectableJobQueueStrategy {
    public concurrency: number | ((queueName: string) => number);
    public pollInterval: number | ((queueName: string) => number);
    public setRetries: (queueName: string, job: Job) => number;
    public backOffStrategy?: BackoffStrategy;
    public gracefulShutdownTimeout: number;

    protected activeQueues = new QueueNameProcessStorage<ActiveQueue<any>>();

    constructor(config?: PollingJobQueueStrategyConfig);
    constructor(concurrency?: number, pollInterval?: number);
    constructor(concurrencyOrConfig?: number | PollingJobQueueStrategyConfig, maybePollInterval?: number) {
        super();

        if (concurrencyOrConfig && isObject(concurrencyOrConfig)) {
            this.concurrency = concurrencyOrConfig.concurrency ?? 1;
            this.pollInterval = concurrencyOrConfig.pollInterval ?? 200;
            this.backOffStrategy = concurrencyOrConfig.backoffStrategy ?? (() => 1000);
            this.setRetries = concurrencyOrConfig.setRetries ?? ((_, job) => job.retries);
            this.gracefulShutdownTimeout = concurrencyOrConfig.gracefulShutdownTimeout ?? 20_000;
        } else {
            this.concurrency = concurrencyOrConfig ?? 1;
            this.pollInterval = maybePollInterval ?? 200;
            this.setRetries = (_, job) => job.retries;
            this.gracefulShutdownTimeout = 20_000;
        }
    }

    async start<Data extends JobData<Data> = object>(
        queueName: string,
        process: (job: Job<Data>) => Promise<any>,
    ) {
        if (!this.hasInitialized) {
            this.started.set(queueName, process);
            return;
        }
        if (this.activeQueues.has(queueName, process)) {
            return;
        }
        const active = new ActiveQueue<Data>(queueName, process, this);
        active.start();
        this.activeQueues.set(queueName, process, active);
    }

    async stop<Data extends JobData<Data> = object>(
        queueName: string,
        process: (job: Job<Data>) => Promise<any>,
    ) {
        const active = this.activeQueues.getAndDelete(queueName, process);
        if (!active) {
            return;
        }
        await active.stop(this.gracefulShutdownTimeout);
    }

    async cancelJob(jobId: ID): Promise<Job | undefined> {
        const job = await this.findOne(jobId);
        if (job) {
            job.cancel();
            await this.update(job);
            return job;
        }
    }

    /**
     * @description
     * Should return the next job in the given queue. The implementation is
     * responsible for returning the correct job according to the time of
     * creation.
     */
    abstract next(queueName: string): Promise<Job | undefined>;

    /**
     * @description
     * Update the job details in the store.
     */
    abstract update(job: Job): Promise<void>;

    /**
     * @description
     * Returns a job by its id.
     */
    abstract findOne(id: ID): Promise<Job | undefined>;
}
