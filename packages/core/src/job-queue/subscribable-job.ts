import { JobState } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import ms from 'ms';
import { concat, defer, EMPTY, interval, Observable, of, timer } from 'rxjs';
import { distinctUntilChanged, filter, map, switchMap, takeUntil, takeWhile, tap } from 'rxjs/operators';

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
     * The maximum time in milliseconds to wait for the job to settle. Once this time has
     * elapsed, the subscription is ended whether or not any updates have already been
     * emitted. Defaults to 1 hour
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
     * The `timeoutMs` option bounds the whole subscription: if the job has not settled by then, polling
     * stops, a final update with a `result` of "Job subscription timed out. The job may still be running"
     * is emitted, and the stream completes.
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
            return defer(() => {
                let jobSettled = false;
                // `takeUntil` bounds the entire subscription by `timeoutMs` rather than just the
                // wait for the first update, and unsubscribes from `updates$` at the deadline so
                // that no polling interval is left running.
                //
                // The `tap` sits upstream of the `takeUntil`, so its `complete` callback fires only
                // when the job itself reaches a terminal state. A `takeUntil` cut-off unsubscribes
                // from the source rather than completing it, which is how the two cases are told
                // apart: only a job that never settled gets the timeout update appended.
                const boundedUpdates$ = updates$.pipe(
                    tap({
                        complete: () => {
                            jobSettled = true;
                        },
                    }),
                    takeUntil(timer(timeoutMs)),
                );
                const timedOut$ = defer(() => {
                    if (jobSettled) {
                        return EMPTY;
                    }
                    Logger.error(
                        `Job ${
                            this.id ?? ''
                        } SubscribableJob update polling timed out after ${timeoutMs}ms. The job may still be running.`,
                    );
                    return of({
                        id: this.id,
                        state: JobState.RUNNING,
                        data: this.data,
                        error: this.error,
                        progress: this.progress,
                        result: 'Job subscription timed out. The job may still be running',
                    } satisfies JobUpdate<any>);
                });
                return concat(boundedUpdates$, timedOut$);
            }) as Observable<JobUpdate<T>>;
        }
    }
}
