import { Type } from '@vendure/common/lib/shared-types';

import { PluginCommonModule } from '../plugin-common.module';
import { VendurePlugin } from '../vendure-plugin';

import { cleanJobsTask } from './clean-jobs-task';
import { DEFAULT_JOB_QUEUE_PLUGIN_OPTIONS } from './constants';
import { JobRecordBuffer } from './job-record-buffer.entity';
import { JobRecord } from './job-record.entity';
import { SqlJobBufferStorageStrategy } from './sql-job-buffer-storage-strategy';
import { SqlJobQueueStrategy } from './sql-job-queue-strategy';
import { DefaultJobQueueOptions } from './types';

/**
 * @description
 * A plugin which configures Vendure to use the SQL database to persist the JobQueue jobs using the {@link SqlJobQueueStrategy}. If you add this
 * plugin to an existing Vendure installation, you'll need to run a [database migration](/developer-guide/migrations), since this
 * plugin will add a new "job_record" table to the database.
 *
 * @example
 * ```ts
 * import { DefaultJobQueuePlugin, VendureConfig } from '\@vendure/core';
 *
 * export const config: VendureConfig = {
 *   // Add an instance of the plugin to the plugins array
 *   plugins: [
 *     DefaultJobQueuePlugin,
 *   ],
 * };
 * ```
 *
 * ## Configuration
 *
 * It is possible to configure the behaviour of the {@link SqlJobQueueStrategy} by passing options to the static `init()` function:
 *
 * ### pollInterval
 * The interval in ms between polling for new jobs. The default is 200ms.
 * Using a longer interval reduces load on the database but results in a slight
 * delay in processing jobs. For more control, it is possible to supply a function which can specify
 * a pollInterval based on the queue name:
 *
 * @example
 * ```ts
 * export const config: VendureConfig = {
 *   plugins: [
 *     DefaultJobQueuePlugin.init({
 *       pollInterval: queueName => {
 *         if (queueName === 'cart-recovery-email') {
 *           // This queue does not need to be polled so frequently,
 *           // so we set a longer interval in order to reduce load
 *           // on the database.
 *           return 10000;
 *         }
 *         return 200;
 *       },
 *     }),
 *   ],
 * };
 * ```
 * ### concurrency
 * The number of jobs to process concurrently per worker. Defaults to 1.
 *
 * ### backoffStrategy
 * Defines the backoff strategy used when retrying failed jobs. In other words, if a job fails
 * and is configured to be re-tried, how long should we wait before the next attempt?
 *
 * By default, a job will be retried as soon as possible, but in some cases this is not desirable. For example,
 * a job may interact with an unreliable 3rd-party API which is sensitive to too many requests. In this case, an
 * exponential backoff may be used which progressively increases the delay between each subsequent retry.
 *
 * @example
 * ```ts
 * export const config: VendureConfig = {
 *   plugins: [
 *     DefaultJobQueuePlugin.init({
 *       pollInterval: 5000,
 *       concurrency: 2
 *       backoffStrategy: (queueName, attemptsMade, job) => {
 *         if (queueName === 'transcode-video') {
 *           // exponential backoff example
 *           return (attemptsMade ** 2) * 1000;
 *         }
 *
 *         // A default delay for all other queues
 *         return 1000;
 *       },
 *       setRetries: (queueName, job) => {
 *         if (queueName === 'send-email') {
 *           // Override the default number of retries
 *           // for the 'send-email' job because we have
 *           // a very unreliable email service.
 *           return 10;
 *         }
 *         return job.retries;
 *       }
 *     }),
 *   ],
 * };
 * ```
 *
 * ### Removing old jobs
 * Since v3.3, the job queue will automatically remove old jobs from the database. This is done by a scheduled task
 * which runs every 2 hours by default. The number of jobs to keep in the database can be configured using the
 * `keepJobsCount` option. The default is 1000.
 *
 * @example
 * ```ts
 * export const config: VendureConfig = {
 *   plugins: [
 *     DefaultJobQueuePlugin.init({
 *       // The number of completed/failed/cancelled
 *       // jobs to keep in the database. The default is 1000.
 *       keepJobsCount: 100,
 *       // The interval at which to run the clean-up task.
 *       // This can be a standard cron expression or a function
 *       // that returns a cron expression. The default is every 2 hours.
 *       cleanJobsSchedule: cron => cron.every(5).hours(),
 *     }),
 *   ],
 * };
 * ```
 *
 * @docsCategory JobQueue
 * @docsPage DefaultJobQueuePlugin
 * @docsWeight 0
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    entities: () =>
        DefaultJobQueuePlugin.options.useDatabaseForBuffer === true
            ? [JobRecord, JobRecordBuffer]
            : [JobRecord],
    configuration: config => {
        const { pollInterval, concurrency, backoffStrategy, setRetries, gracefulShutdownTimeout } =
            DefaultJobQueuePlugin.options ?? {};
        config.jobQueueOptions.jobQueueStrategy = new SqlJobQueueStrategy({
            concurrency,
            pollInterval,
            backoffStrategy,
            setRetries,
            gracefulShutdownTimeout,
        });
        if (DefaultJobQueuePlugin.options.useDatabaseForBuffer === true) {
            config.jobQueueOptions.jobBufferStorageStrategy = new SqlJobBufferStorageStrategy();
        }
        config.schedulerOptions.tasks.push(
            cleanJobsTask.configure({
                schedule: DefaultJobQueuePlugin.options.cleanJobsSchedule,
            }),
        );
        return config;
    },
    providers: [
        {
            provide: DEFAULT_JOB_QUEUE_PLUGIN_OPTIONS,
            useFactory: () => DefaultJobQueuePlugin.options,
        },
    ],
    compatibility: '>0.0.0',
})
export class DefaultJobQueuePlugin {
    /** @internal */
    static options: DefaultJobQueueOptions = {};

    static init(options: DefaultJobQueueOptions): Type<DefaultJobQueuePlugin> {
        DefaultJobQueuePlugin.options = options;
        return DefaultJobQueuePlugin;
    }
}
