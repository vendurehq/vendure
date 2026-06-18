import { Logger } from '../../config';
import { TransactionalConnection } from '../../connection';
import { ScheduledTask } from '../../scheduler/scheduled-task';

import { DEFAULT_JOB_QUEUE_PLUGIN_OPTIONS, DEFAULT_KEEP_JOBS_COUNT } from './constants';
import { JobRecord } from './job-record.entity';
import { DefaultJobQueueOptions } from './types';

/**
 * @description
 * A {@link ScheduledTask} that cleans up old jobs from the database when using the DefaultJobQueuePlugin.
 * You can configure the settings & schedule of the task via the {@link DefaultJobQueuePlugin} options.
 *
 * @since 3.3.0
 * @docsCategory JobQueue
 * @docsPage DefaultJobQueuePlugin
 */
export const cleanJobsTask = new ScheduledTask({
    id: 'clean-jobs',
    description: 'Clean completed, failed, and cancelled jobs from the database',
    schedule: cron => cron.every(2).hours(),
    async execute({ injector, params }) {
        const options = injector.get<DefaultJobQueueOptions>(DEFAULT_JOB_QUEUE_PLUGIN_OPTIONS);
        const keepJobsCount = options.keepJobsCount || DEFAULT_KEEP_JOBS_COUNT;
        const connection = injector.get(TransactionalConnection);
        const qb = connection.rawConnection
            .getRepository(JobRecord)
            .createQueryBuilder('job')
            .where(`job.state IN (:...states)`, {
                states: ['COMPLETED', 'FAILED', 'CANCELLED'],
            })
            .orderBy('job.createdAt', 'ASC');

        const count = await qb.getCount();

        const BATCH_SIZE = 100;
        const numberOfJobsToDelete = Math.max(count - keepJobsCount, 0);
        if (0 < numberOfJobsToDelete) {
            const jobsToDelete = await qb.select('id').limit(numberOfJobsToDelete).getRawMany();
            Logger.verbose(`Cleaning up ${jobsToDelete.length} jobs...`);
            for (let i = 0; i < jobsToDelete.length; i += BATCH_SIZE) {
                const batch = jobsToDelete.slice(i, i + BATCH_SIZE);
                await connection.rawConnection
                    .getRepository(JobRecord)
                    .delete(batch.map(job => job.id) as string[]);
            }
        }
        return {
            jobRecordsDeleted: numberOfJobsToDelete,
        };
    },
});
