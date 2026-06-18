import {
    DateOperators,
    JobFilterParameter,
    JobListOptions,
    JobSortParameter,
    JobState,
    NumberOperators,
    StringOperators,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

import { Injector } from '../common';
import { InspectableJobQueueStrategy } from '../config/job-queue/inspectable-job-queue-strategy';
import { Logger } from '../config/logger/vendure-logger';
import { ProcessContext } from '../process-context/process-context';

import { Job } from './job';
import { PollingJobQueueStrategy } from './polling-job-queue-strategy';
import { JobData } from './types';

/**
 * @description
 * An in-memory {@link JobQueueStrategy}. This is the default strategy if not using a dedicated
 * JobQueue plugin (e.g. {@link DefaultJobQueuePlugin}). Not recommended for production, since
 * the queue will be cleared when the server stops, and can only be used when the JobQueueService is
 * started from the main server process:
 *
 * @example
 * ```ts
 * bootstrap(config)
 *   .then(app => app.get(JobQueueService).start());
 * ```
 *
 * Attempting to use this strategy when running the worker in a separate process (using `bootstrapWorker()`)
 * will result in an error on startup.
 *
 * Completed jobs will be evicted from the store every 2 hours to prevent a memory leak.
 *
 * @docsCategory JobQueue
 */
export class InMemoryJobQueueStrategy extends PollingJobQueueStrategy implements InspectableJobQueueStrategy {
    protected jobs = new Map<ID, Job>();
    protected unsettledJobs: { [queueName: string]: Array<{ job: Job; updatedAt: Date }> } = {};
    private timer: any;
    private evictJobsAfterMs = 1000 * 60 * 60 * 2; // 2 hours
    private processContext: ProcessContext;
    private processContextChecked = false;

    init(injector: Injector) {
        super.init(injector);
        this.processContext = injector.get(ProcessContext);
        this.timer = setTimeout(this.evictSettledJobs, this.evictJobsAfterMs);
    }

    destroy() {
        super.destroy();
        clearTimeout(this.timer);
    }

    async add<Data extends JobData<Data> = object>(job: Job<Data>): Promise<Job<Data>> {
        if (!job.id) {
            (job as any).id = Math.floor(Math.random() * 1000000000)
                .toString()
                .padEnd(10, '0');
        }
        (job as any).retries = this.setRetries(job.queueName, job);
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.jobs.set(job.id!, job);
        if (!this.unsettledJobs[job.queueName]) {
            this.unsettledJobs[job.queueName] = [];
        }
        this.unsettledJobs[job.queueName].push({ job, updatedAt: new Date() });
        return job;
    }

    async findOne(id: ID): Promise<Job | undefined> {
        return this.jobs.get(id);
    }

    async findMany(options?: JobListOptions): Promise<PaginatedList<Job>> {
        let items = [...this.jobs.values()];
        if (options) {
            if (options.sort) {
                items = this.applySort(items, options.sort);
            }
            if (options.filter) {
                items = this.applyFilters(items, options.filter);
            }
            if (options.skip || options.take) {
                items = this.applyPagination(items, options.skip, options.take);
            }
        }
        return {
            items,
            totalItems: items.length,
        };
    }

    async findManyById(ids: ID[]): Promise<Job[]> {
        return ids.map(id => this.jobs.get(id)).filter(notNullOrUndefined);
    }

    async next(queueName: string, waitingJobs: Job[] = []): Promise<Job | undefined> {
        this.checkProcessContext();
        const nextIndex = this.unsettledJobs[queueName]?.findIndex(item => !waitingJobs.includes(item.job));
        if (nextIndex === -1) {
            return;
        }
        const next = this.unsettledJobs[queueName]?.splice(nextIndex, 1)[0];
        if (next) {
            if (next.job.state === JobState.RETRYING && typeof this.backOffStrategy === 'function') {
                const msSinceLastFailure = Date.now() - +next.updatedAt;
                const backOffDelayMs = this.backOffStrategy(queueName, next.job.attempts, next.job);
                if (msSinceLastFailure < backOffDelayMs) {
                    this.unsettledJobs[queueName]?.push(next);
                    return;
                }
            }
            next.job.start();
            return next.job;
        }
    }

    async update(job: Job): Promise<void> {
        if (job.state === JobState.RETRYING || job.state === JobState.PENDING) {
            this.unsettledJobs[job.queueName].unshift({ job, updatedAt: new Date() });
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        this.jobs.set(job.id!, job);
    }

    async removeSettledJobs(queueNames: string[] = [], olderThan?: Date): Promise<number> {
        let removed = 0;
        for (const job of this.jobs.values()) {
            if (0 < queueNames.length && !queueNames.includes(job.queueName)) {
                continue;
            }
            if (job.isSettled) {
                if (olderThan) {
                    if (job.settledAt && job.settledAt < olderThan) {
                        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                        this.jobs.delete(job.id!);
                        removed++;
                    }
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    this.jobs.delete(job.id!);
                    removed++;
                }
            }
        }
        return removed;
    }

    private applySort(items: Job[], sort: JobSortParameter): Job[] {
        for (const [prop, direction] of Object.entries(sort)) {
            const key = prop as keyof Required<JobSortParameter>;
            const dir = direction === 'ASC' ? -1 : 1;
            items = items.sort((a, b) => ((a[key] || 0) < (b[key] || 0) ? 1 * dir : -1 * dir));
        }
        return items;
    }

    private applyFilters(items: Job[], filters: JobFilterParameter): Job[] {
        for (const [prop, operator] of Object.entries(filters)) {
            const key = prop as keyof Required<Omit<JobFilterParameter, '_and' | '_or'>>;
            if (Array.isArray(operator)) {
                continue;
            }
            if (operator?.eq !== undefined) {
                items = items.filter(i => i[key] === operator.eq);
            }

            const contains = (operator as StringOperators)?.contains;
            if (contains) {
                items = items.filter(i => (i[key] as string).includes(contains));
            }
            const gt = (operator as NumberOperators)?.gt;
            if (gt) {
                items = items.filter(i => (i[key] as number) > gt);
            }
            const gte = (operator as NumberOperators)?.gte;
            if (gte) {
                items = items.filter(i => (i[key] as number) >= gte);
            }
            const lt = (operator as NumberOperators)?.lt;
            if (lt) {
                items = items.filter(i => (i[key] as number) < lt);
            }
            const lte = (operator as NumberOperators)?.lte;
            if (lte) {
                items = items.filter(i => (i[key] as number) <= lte);
            }
            const before = (operator as DateOperators)?.before;
            if (before) {
                items = items.filter(i => (i[key] as Date) <= before);
            }
            const after = (operator as DateOperators)?.after;
            if (after) {
                items = items.filter(i => (i[key] as Date) >= after);
            }
            const between = (operator as NumberOperators)?.between;
            if (between) {
                items = items.filter(i => {
                    const num = i[key] as number;
                    return num > between.start && num < between.end;
                });
            }
        }
        return items;
    }

    private applyPagination(items: Job[], skip?: number | null, take?: number | null): Job[] {
        const start = skip || 0;
        const end = take != null ? start + take : undefined;
        return items.slice(start, end);
    }

    /**
     * Delete old jobs from the `jobs` Map if they are settled and older than the value
     * defined in `this.pruneJobsAfterMs`. This prevents a memory leak as the job queue
     * grows indefinitely.
     */
    private evictSettledJobs = () => {
        const nowMs = +new Date();
        const olderThanMs = nowMs - this.evictJobsAfterMs;
        void this.removeSettledJobs([], new Date(olderThanMs));
        this.timer = setTimeout(this.evictSettledJobs, this.evictJobsAfterMs);
    };

    private checkProcessContext() {
        if (!this.processContextChecked) {
            if (this.processContext.isWorker) {
                Logger.error(
                    'The InMemoryJobQueueStrategy will not work when running job queues outside the main server process!',
                );
                process.kill(process.pid, 'SIGINT');
            }
            this.processContextChecked = true;
        }
    }
}
