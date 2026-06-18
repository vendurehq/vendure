import { Job } from '../job';
import { JobData } from '../types';

/**
 * @description
 * A JobBuffer is used to temporarily prevent jobs from being sent to the job queue for processing.
 * Instead, it collects certain jobs (as specified by the `collect()` method), and stores them.
 *
 * How these buffered jobs are stored is determined by the configured {@link JobBufferStorageStrategy}.
 *
 * The JobBuffer can be thought of as a kind of "interceptor" of jobs. That is, when a JobBuffer is active,
 * it sits in between calls to `JobQueue.add()` and the actual adding of the job to the queue.
 *
 * At some later point, the buffer can be flushed (by calling `JobQueue.flush()`), at which point all the jobs
 * that were collected into the buffer will be removed from the buffer and passed to the `JobBuffer.reduce()` method.
 * This method is able to perform additional logic to e.g. aggregate many jobs into a single job in order to de-duplicate
 * work.
 *
 * @example
 * ```ts
 * // This is a buffer which will collect all the
 * // 'apply-collection-filters' jobs and buffer them.
 * export class CollectionJobBuffer implements JobBuffer<ApplyCollectionFiltersJobData> {
 *   readonly id = 'apply-collection-filters-buffer';
 *
 *   collect(job: Job): boolean {
 *     return job.queueName === 'apply-collection-filters';
 *   }
 *
 *
 *   // When the buffer gets flushed, this function will be passed all the collected jobs
 *   // and will reduce them down to a single job that has aggregated all of the collectionIds.
 *   reduce(collectedJobs: Array<Job<ApplyCollectionFiltersJobData>>): Array<Job<any>> {
 *     // Concatenate all the collectionIds from all the events that were buffered
 *     const collectionIdsToUpdate = collectedJobs.reduce((result, job) => {
 *       return [...result, ...job.data.collectionIds];
 *     }, [] as ID[]);
 *
 *     const referenceJob = collectedJobs[0];
 *
 *     // Create a new Job containing all the concatenated collectionIds,
 *     // de-duplicated to include each collectionId only once.
 *     const batchedCollectionJob = new Job<ApplyCollectionFiltersJobData>({
 *       ...referenceJob,
 *       id: undefined,
 *       data: {
 *         collectionIds: unique(collectionIdsToUpdate),
 *         ctx: referenceJob.data.ctx,
 *         applyToChangedVariantsOnly: referenceJob.data.applyToChangedVariantsOnly,
 *       },
 *     });
 *
 *     // Only this single job will get added to the job queue
 *     return [batchedCollectionJob];
 *   }
 * }
 * ```
 *
 * A JobBuffer is used by adding it to the {@link JobQueueService}, at which point it will become active
 * and start collecting jobs.
 *
 * At some later point, the buffer can be flushed, causing the buffered jobs to be passed through the
 * `reduce()` method and sent to the job queue.
 *
 * @example
 * ```ts
 * const collectionBuffer = new CollectionJobBuffer();
 *
 * await this.jobQueueService.addBuffer(collectionBuffer);
 *
 * // Here you can perform some work which would ordinarily
 * // trigger the 'apply-collection-filters' job, such as updating
 * // collection filters or changing ProductVariant prices.
 *
 * await this.jobQueueService.flush(collectionBuffer);
 *
 * await this.jobQueueService.removeBuffer(collectionBuffer);
 * ```
 *
 * @docsCategory JobQueue
 * @since 1.3.0
 */
export interface JobBuffer<Data extends JobData<Data> = object> {
    readonly id: string;

    /**
     * @description
     * This method is called whenever a job is added to the job queue. If it returns `true`, then
     * the job will be _buffered_ and _not_ added to the job queue. If it returns `false`, the job
     * will be added to the job queue as normal.
     */
    collect(job: Job<Data>): boolean | Promise<boolean>;

    /**
     * @description
     * This method is called whenever the buffer gets flushed via a call to `JobQueueService.flush()`.
     * It allows logic to be run on the buffered jobs which enables optimizations such as
     * aggregating and de-duplicating the work of many jobs into one job.
     */
    reduce(collectedJobs: Array<Job<Data>>): Array<Job<Data>> | Promise<Array<Job<Data>>>;
}
