import { JobState } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import ms from 'ms';
import { interval, Observable, race, timer } from 'rxjs';
import { distinctUntilChanged, filter, map, switchMap, takeWhile, tap } from 'rxjs/operators';

import { InternalServerError } from '../common/error/errors';
import { Logger } from '../config/index';
import { isInspectableJobQueueStrategy } from '../config/job-queue/inspectable-job-queue-strategy';
import { JobQueueStrategy } from '../config/job-queue/job-queue-strategy';

import { Job } from './job';
import { JobConfig, JobData } from './types';

/**
 * @description
 * Job update status as returned from the {@link SubscribableJob}'s `update()` method.
 *
 * @docsCategory JobQueue
 * @docsPage types
 */
export type JobUpdate<T extends JobData<T>> = Pick<
    Job<T>,
    'id' | 'state' | 'progress' | 'result' | 'error' | 'data'
>;

/**
 * @description
 * Job update options, that you can specify by calling {@link SubscribableJob} `updates` method.
 *
 * @docsCategory JobQueue
 * @docsPage types
 */
export type JobUpdateOptions = {
    /**
     * Polling interval. Defaults to 200ms
     */
    pollInterval?: number;
    /**
     * Polling timeout in milliseconds. Defaults to 1 hour
     */
    timeoutMs?: number;
    /**
     * Observable sequence will end with an error if true. Default to true
     */
    errorOnFail?: boolean;
};

/**
 * @description
 * This is a type of Job object that allows you to subscribe to updates to the Job. It is returned
 * by the {@link JobQueue}'s `add()` method. Note that the subscription capability is only supported
 * if the {@link JobQueueStrategy} implements the {@link InspectableJobQueueStrategy} interface (e.g.
 * the {@link SqlJobQueueStrategy} does support this).
 *
 * @docsCategory JobQueue
 */
export class SubscribableJob<T extends JobData<T> = any> extends Job<T> {
    private readonly jobQueueStrategy: JobQueueStrategy;

    constructor(job: Job<T>, jobQueueStrategy: JobQueueStrategy) {
        const config: JobConfig<T> = {
            ...job,
            state: job.state,
            data: job.data,
            id: job.id || undefined,
        };
        super(config);
        this.jobQueueStrategy = jobQueueStrategy;
    }

    /**
     * @description
     * Returns an Observable stream of updates to the Job. Works by polling the current JobQueueStrategy's `findOne()` method
     * to obtain updates. If the updates are not subscribed to, then no polling occurs.
     *
     * Polling interval, timeout and other options may be configured with an options arguments {@link JobUpdateOptions}.
     *
     */
    updates(options?: JobUpdateOptions): Observable<JobUpdate<T>> {
        const pollInterval = Math.max(50, options?.pollInterval ?? 200);
        const timeoutMs = Math.max(1, options?.timeoutMs ?? ms('1h'));
        const strategy = this.jobQueueStrategy;
        if (!isInspectableJobQueueStrategy(strategy)) {
            throw new InternalServerError(
                `The configured JobQueueStrategy (${strategy.constructor.name}) is not inspectable, so Job updates cannot be subscribed to`,
            );
        } else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const updates$ = interval(pollInterval).pipe(
                switchMap(() => {
                    const id = this.id;
                    if (!id) {
                        throw new Error('Cannot subscribe to update: Job does not have an ID');
                    }
                    return strategy.findOne(id);
                }),
                filter(notNullOrUndefined),
                distinctUntilChanged((a, b) => a?.progress === b?.progress && a?.state === b?.state),
                takeWhile(
                    job =>
                        job?.state !== JobState.FAILED &&
                        job.state !== JobState.COMPLETED &&
                        job.state !== JobState.CANCELLED,
                    true,
                ),
                tap(job => {
                    if (job.state === JobState.FAILED && (options?.errorOnFail ?? true)) {
                        throw new Error(job.error);
                    }
                }),
                map(job => pick(job, ['id', 'state', 'progress', 'result', 'error', 'data'])),
            );
            const timeout$ = timer(timeoutMs).pipe(
                tap(i => {
                    Logger.error(
                        `Job ${
                            this.id ?? ''
                        } SubscribableJob update polling timed out after ${timeoutMs}ms. The job may still be running.`,
                    );
                }),
                map(
                    () =>
                        ({
                            id: this.id,
                            state: JobState.RUNNING,
                            data: this.data,
                            error: this.error,
                            progress: this.progress,
                            result: 'Job subscription timed out. The job may still be running',
                        }) satisfies JobUpdate<any>,
                ),
            );

            // Use race() to return whichever observable emits first and follow it to completion.
            // - If updates$ emits first, it will continue emitting until the job settles
            // - If timeout$ emits first, it will emit the timeout message and complete
            return race(updates$, timeout$) as Observable<JobUpdate<T>>;
        }
    }
}
