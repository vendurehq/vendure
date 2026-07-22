import { Inject, Injectable } from '@nestjs/common';
import { Logger, ProcessContext } from '@vendure/core';
import { Job, JobType, Queue, QueueEvents } from 'bullmq';
import Redis, { Cluster } from 'ioredis';

import { BULLMQ_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { BullMQPluginOptions } from './types';
import { getPrefix } from './utils';

/**
 * @description
 * In order to efficiently query jobs in the job queue, we use a "sorted set" in Redis to track jobs
 * added to each queue. This allows to quickly fetch a list of jobs in a given queue without needing
 * to iterate over all jobs in the queue and read the job data.
 *
 * By using this approach we can achieve a several order of magnitude improvement in performance
 * over the former approach of iterating over all jobs via the custom LUA script.
 *
 * This also means that we need to periodically clean up the sorted sets to remove jobs that have
 * been removed from the queue (via the automatic removal features of BullMQ). Why do we need to
 * do this scheduled cleanup? Because currently BullMQ does not provide an event for when a job
 * is automatically removed from the queue, so we cannot listen for that event and remove. The
 * "removed" event is only emitted when a job is removed manually via the `remove()` method.
 * See https://github.com/taskforcesh/bullmq/issues/3209#issuecomment-2795102551
 */
@Injectable()
export class JobListIndexService {
    private readonly BATCH_SIZE = 100;
    private redis: Redis | Cluster;
    private queue: Queue | undefined;
    private queueEvents: QueueEvents | undefined;
    private readonly indexOperationChains = new Map<string, Promise<void>>();
    private allStates: JobType[] = [
        'wait',
        'active',
        'completed',
        'failed',
        'delayed',
        'waiting-children',
        'prioritized',
    ];

    constructor(
        @Inject(BULLMQ_PLUGIN_OPTIONS) private readonly options: BullMQPluginOptions,
        private readonly processContext: ProcessContext,
    ) {}

    /**
     * @description
     * Should be called by the BullMQJobQueueStrategy as soon as the Redis connection and Queue
     * object are available in the init() function.
     */
    register(redisConnection: Redis | Cluster, queue: Queue) {
        this.redis = redisConnection;
        this.queue = queue;
        this.queueEvents = new QueueEvents(queue.name, {
            connection: redisConnection,
            prefix: getPrefix(this.options),
        });
        this.setupEventListeners();
        void this.migrateExistingJobs();
    }

    /**
     * @description
     * Closes the QueueEvents connection. Should be called when the strategy is destroyed.
     */
    async close() {
        await this.queueEvents?.close();
    }

    private setupEventListeners() {
        if (this.processContext.isServer) return;
        if (!this.queueEvents || !this.queue) return;

        this.indexOnEvent('waiting', 'wait');
        this.indexOnEvent('waiting-children', 'waiting-children');
        this.indexOnEvent('active', 'active');
        this.indexOnEvent('completed', 'completed');
        this.indexOnEvent('failed', 'failed');
        this.indexOnEvent('delayed', 'delayed');

        // When a job is removed
        this.queueEvents.on('removed', ({ jobId }) => {
            this.enqueueIndexOperation(jobId, () => this.removeJobFromAllIndices(jobId));
        });
    }

    /**
     * Registers a QueueEvents listener which re-indexes the job under the given state.
     */
    private indexOnEvent(
        event: 'waiting' | 'waiting-children' | 'active' | 'completed' | 'failed' | 'delayed',
        state: JobType,
    ) {
        this.queueEvents?.on(event, ({ jobId }: { jobId: string }) => {
            this.enqueueIndexOperation(jobId, () => this.updateJobIndex(jobId, state));
        });
    }

    /**
     * The event handlers fire in event-stream order but run asynchronously, so two
     * updates for the same job could otherwise interleave and leave the job indexed
     * under a stale state. Chaining the operations per job id preserves the order.
     */
    private enqueueIndexOperation(jobId: string, operation: () => Promise<void>) {
        const chain = (this.indexOperationChains.get(jobId) ?? Promise.resolve()).then(operation);
        this.indexOperationChains.set(jobId, chain);
        void chain.finally(() => {
            if (this.indexOperationChains.get(jobId) === chain) {
                this.indexOperationChains.delete(jobId);
            }
        });
    }

    /**
     * When a job's state changes, we need to update the indexed set
     * to reflect the new state of the job.
     */
    private async updateJobIndex(jobId: string, state: JobType) {
        if (!this.redis || !this.queue) return;

        try {
            const job: Job | undefined = await this.queue.getJob(jobId);
            if (!job) return;
            const targetKey = this.createSortedSetKey(job.name, state);

            // Atomically move the job to the target state index, and record the
            // queue name so that removeJobFromAllIndices() can find the indexed
            // sets without needing the (possibly deleted) job data.
            const multi = this.redis.multi();
            multi.sadd(this.createRegistryKey(), job.name);
            for (const otherState of this.allStates) {
                if (otherState !== state) {
                    multi.zrem(this.createSortedSetKey(job.name, otherState), jobId);
                }
            }
            multi.zadd(targetKey, job.timestamp, jobId);
            await multi.exec();
            Logger.debug(`Added job ${jobId} to indexed key: ${targetKey}`, loggerCtx);
        } catch (err: unknown) {
            const error = err as Error;
            Logger.error(`Failed to update job index: ${error.message}`, loggerCtx);
        }
    }

    /**
     * By the time the 'removed' event is handled, the job data has already been
     * deleted from Redis, so the queue name cannot be looked up from the job.
     * Instead, the registry of known queue names is used to clear the id from
     * every indexed set it could be in.
     */
    private async removeJobFromAllIndices(jobId: string) {
        if (!this.redis || !this.queue) return;

        try {
            const queueNames = await this.redis.smembers(this.createRegistryKey());
            if (queueNames.length === 0) return;
            const multi = this.redis.multi();

            for (const queueName of queueNames) {
                for (const state of this.allStates) {
                    multi.zrem(this.createSortedSetKey(queueName, state), jobId);
                }
            }

            await multi.exec();
        } catch (err: unknown) {
            const error = err as Error;
            Logger.error(`Failed to remove job from indices: ${error.message}`, loggerCtx);
        }
    }

    /**
     * @description
     * This method is used to migrate existing jobs to use the indexed set method of tracking jobs.
     * When the app bootstraps, we check to see if the existing jobs in the queue have a corresponding
     * indexed set. If not, we create the indexed set and add the jobs to it.
     */
    async migrateExistingJobs(): Promise<void> {
        if (this.processContext.isServer) {
            // We only want to perform this work on the worker.
            return;
        }
        if (!this.redis || !this.queue) {
            throw new Error('Redis and Queue must be registered before migrating jobs');
        }
        Logger.debug('Starting migration of existing jobs to indexed sets...', loggerCtx);
        // Get counts of jobs in each state
        const counts = await this.queue.getJobCounts();
        Logger.debug(`Found job counts: ${JSON.stringify(counts)}`, loggerCtx);

        let totalMigrated = 0;

        // Get all jobs from each state
        for (const state of this.allStates) {
            if (counts[state] > 0) {
                Logger.debug(`Processing ${counts[state]} jobs in ${state} state`, loggerCtx);
                if (!this.queue) {
                    Logger.error('Queue is not initialized', loggerCtx);
                    continue;
                }
                try {
                    const jobs = await this.queue.getJobs([state], 0, counts[state]);
                    if (!jobs) {
                        Logger.error(`getJobs returned undefined for state ${state}`, loggerCtx);
                        continue;
                    }
                    Logger.debug(`Retrieved ${jobs.length} jobs for state ${state}`, loggerCtx);

                    // Group jobs by queue name
                    const jobsByQueue = new Map<string, Job[]>();
                    for (const job of jobs) {
                        if (!job) {
                            Logger.error('Null job found in results', loggerCtx);
                            continue;
                        }
                        if (!jobsByQueue.has(job.name)) {
                            jobsByQueue.set(job.name, []);
                        }
                        jobsByQueue.get(job.name)?.push(job);
                    }

                    // Merge each queue's jobs into its indexed set. The zadds are
                    // idempotent (same score for the same member), so this also picks
                    // up jobs which were added while no worker was listening for
                    // queue events, without disturbing existing entries.
                    for (const [queueName, queueJobs] of jobsByQueue) {
                        await this.redis.sadd(this.createRegistryKey(), queueName);
                        const indexedKey = this.createSortedSetKey(queueName, state);
                        Logger.debug(
                            `Merging ${queueJobs.length} jobs into indexed set for queue: ${queueName} in state: ${state}`,
                            loggerCtx,
                        );
                        const pipeline = this.redis.pipeline();
                        // Add jobs in batches
                        for (let i = 0; i < queueJobs.length; i += this.BATCH_SIZE) {
                            const batch = queueJobs.slice(i, i + this.BATCH_SIZE);
                            const args = batch
                                .flatMap(job => [job.timestamp, job.id])
                                .filter((id): id is string | number => id != null);
                            pipeline.zadd(indexedKey, ...args);
                        }
                        await pipeline.exec();
                        totalMigrated += queueJobs.length;
                    }
                } catch (err: unknown) {
                    const error = err as Error;
                    Logger.error(`Failed to migrate jobs: ${error.message}`, loggerCtx);
                }
            }
        }

        if (totalMigrated > 0) {
            Logger.info(`Successfully migrated ${totalMigrated} jobs to indexed sets`, loggerCtx);
        }
    }

    /**
     * @description
     * This method is used to clean up the indexed sets to remove jobs that have been removed from the queue.
     * This is done by checking each job in the indexed set to see if it still exists in the queue. If it does not,
     * it is removed from the indexed set.
     */
    async cleanupIndexedSets() {
        if (!this.redis || !this.queue) {
            throw new Error('Redis and Queue must be registered before cleaning up indexed sets');
        }

        // Get all queue names from our indexed sets
        const allStateKeys = this.createSortedSetKey('*');
        const keys: string[] = [];
        let scanCursor = '0';

        do {
            const [nextCursor, foundKeys] = await this.redis.scan(
                scanCursor,
                'MATCH',
                allStateKeys,
                'COUNT',
                this.BATCH_SIZE,
            );
            scanCursor = nextCursor;
            keys.push(...foundKeys);
        } while (scanCursor !== '0');

        const result: Array<{ queueName: string; jobsRemoved: number }> = [];
        const startTime = Date.now();
        Logger.verbose(`Cleaning up ${keys.length} indexed sets`, loggerCtx);

        for (const key of keys) {
            let cursor = '0';
            let jobsRemoved = 0;

            // Use ZSCAN to iterate over the set in batches
            do {
                const [nextCursor, elements] = await this.redis.zscan(key, cursor, 'COUNT', this.BATCH_SIZE);
                cursor = nextCursor;

                if (elements.length > 0) {
                    // Extract job IDs from the elements (they come as [score, id] pairs)
                    const jobIds = elements.filter((_, i) => i % 2 === 0);

                    // Check existence of jobs directly in Redis
                    const pipeline = this.redis.pipeline();
                    for (const jobId of jobIds) {
                        pipeline.exists(this.createQueueItemKey(jobId));
                    }
                    const existsResults = await pipeline.exec();

                    // Filter out non-existent jobs
                    const jobsToRemove = jobIds.filter((jobId, i) => {
                        const exists = existsResults?.[i]?.[1] === 1;
                        return !exists;
                    });

                    if (jobsToRemove.length > 0) {
                        await this.redis.zrem(key, ...jobsToRemove);
                        jobsRemoved += jobsToRemove.length;
                    }
                }
            } while (cursor !== '0');

            if (jobsRemoved > 0) {
                Logger.verbose(
                    `Cleaned up ${jobsRemoved} non-existent jobs from indexed key: ${key}`,
                    loggerCtx,
                );
            }
            result.push({ queueName: key, jobsRemoved });
        }

        const endTime = Date.now();
        Logger.verbose(`Cleaned up ${keys.length} indexed sets in ${endTime - startTime}ms`, loggerCtx);
        return result;
    }

    private createSortedSetKey(queueName: string, state?: string): string {
        const prefix = getPrefix(this.options);
        if (!this.queue) {
            throw new Error('Queue is not initialized');
        }
        let key = `${prefix}:${this.queue.name}:queue:${queueName}`;
        if (state) {
            key += `:${state}`;
        }
        return key;
    }

    private createQueueItemKey(jobId: string): string {
        const prefix = getPrefix(this.options);
        if (!this.queue) {
            throw new Error('Queue is not initialized');
        }
        return `${prefix}:${this.queue.name}:${jobId}`;
    }

    /**
     * The registry is a Redis set holding all Vendure queue names which have been
     * indexed. It allows removal of a job id from all indexed sets even when the
     * job data (and with it the queue name) is no longer available, and lets the
     * getJobsByType script enumerate every indexed set for unfiltered queries.
     */
    private createRegistryKey(): string {
        const prefix = getPrefix(this.options);
        if (!this.queue) {
            throw new Error('Queue is not initialized');
        }
        return `${prefix}:${this.queue.name}:queue-names`;
    }
}
