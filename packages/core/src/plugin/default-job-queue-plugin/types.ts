import { BackoffStrategy, Job } from '../../job-queue';
import { ScheduledTaskConfig } from '../../scheduler';

/**
 * @description
 * Configuration options for the DefaultJobQueuePlugin. These values get passed into the
 * {@link SqlJobQueueStrategy}.
 *
 * @docsCategory JobQueue
 * @docsPage DefaultJobQueuePlugin
 */
export interface DefaultJobQueueOptions {
    /**
     * @description
     * The interval in ms between polling the database for new jobs. If many job queues
     * are active, the polling may cause undue load on the database, in which case this value
     * should be increased to e.g. 1000.
     *
     * @default 200
     */
    pollInterval?: number | ((queueName: string) => number);
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
     * DefaultJobQueuePlugin.init({
     *   concurrency: (queueName) => {
     *     if (queueName === 'apply-collection-filters') {
     *       return 1;
     *     }
     *     return 3;
     *   }
     * })
     * ```
     *
     * @default 1
     */
    concurrency?: number | ((queueName: string) => number);
    /**
     * @description
     * The strategy used to decide how long to wait before retrying a failed job.
     *
     * @default () => 1000
     */
    backoffStrategy?: BackoffStrategy;
    /**
     * @description
     * When a job is added to the JobQueue using `JobQueue.add()`, the calling
     * code may specify the number of retries in case of failure. This option allows
     * you to override that number and specify your own number of retries based on
     * the job being added.
     *
     * @example
     * ```ts
     * setRetries: (queueName, job) => {
     *   if (queueName === 'send-email') {
     *     // Override the default number of retries
     *     // for the 'send-email' job because we have
     *     // a very unreliable email service.
     *     return 10;
     *   }
     *   return job.retries;
     * }
     *  ```
     * @param queueName
     * @param job
     */
    setRetries?: (queueName: string, job: Job) => number;
    /**
     * @description
     * If set to `true`, the database will be used to store buffered jobs. This is
     * recommended for production.
     *
     * When enabled, a new `JobRecordBuffer` database entity will be defined which will
     * require a migration when first enabling this option.
     *
     * @since 1.3.0
     */
    useDatabaseForBuffer?: boolean;
    /**
     * @description
     * The timeout in ms which the queue will use when attempting a graceful shutdown.
     * That means when the server is shut down but a job is running, the job queue will
     * wait for the job to complete before allowing the server to shut down. If the job
     * does not complete within this timeout window, the job will be forced to stop
     * and the server will shut down anyway.
     *
     * @since 2.2.0
     * @default 20_000
     */
    gracefulShutdownTimeout?: number;
    /**
     * @description
     * The number of completed/failed jobs to keep in the database. This is useful for
     * debugging and auditing purposes, but if you have a lot of jobs, it may be
     * desirable to limit the number of records in the database.
     *
     * @since 3.3.0
     * @default 1000
     */
    keepJobsCount?: number;
    /**
     * @description
     * The schedule for the "clean-jobs" task. This task will run periodically to clean up
     * old jobs from the database. The schedule can be a cron expression or a function
     * that returns a cron expression.
     *
     * @since 3.3.0
     * @default cron => cron.every(2).hours()
     */
    cleanJobsSchedule?: ScheduledTaskConfig['schedule'];
}
