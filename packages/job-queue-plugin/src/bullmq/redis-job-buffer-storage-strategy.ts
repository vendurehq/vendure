import { Injector, Job, JobBufferStorageStrategy, JobConfig, Logger } from '@vendure/core';
import { Cluster, Redis, RedisOptions } from 'ioredis';

import { BULLMQ_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { BullMQPluginOptions } from './types';
import { getPrefix } from './utils';

const BUFFER_LIST_PREFIX = 'vendure-job-buffer';

export class RedisJobBufferStorageStrategy implements JobBufferStorageStrategy {
    private redis: Redis | Cluster;
    private prefix: string;

    init(injector: Injector) {
        const options = injector.get<BullMQPluginOptions>(BULLMQ_PLUGIN_OPTIONS);
        this.prefix = `${getPrefix(options)}:`;
        if (options.connection instanceof Redis) {
            this.redis = options.connection;
        } else if (options.connection instanceof Cluster) {
            this.redis = options.connection;
        } else {
            this.redis = new Redis(options.connection as RedisOptions);
        }
    }

    async add(bufferId: string, job: Job<any>): Promise<Job<any>> {
        const result = await this.redis.lpush(this.keyName(bufferId), this.toJobConfigString(job));
        return job;
    }

    async bufferSize(bufferIds?: string[]): Promise<{ [bufferId: string]: number }> {
        const ids = bufferIds?.length ? bufferIds : await this.getAllBufferIds();
        const result: { [bufferId: string]: number } = {};
        for (const id of bufferIds || []) {
            const key = this.keyName(id);
            const count = await this.redis.llen(key);
            result[id] = count;
        }
        return result;
    }

    async flush(bufferIds?: string[]): Promise<{ [bufferId: string]: Job[] }> {
        const ids = bufferIds?.length ? bufferIds : await this.getAllBufferIds();
        const result: { [bufferId: string]: Job[] } = {};
        for (const id of bufferIds || []) {
            const key = this.keyName(id);
            const items = await this.redis.lrange(key, 0, -1);
            await this.redis.del(key);
            result[id] = items.map(item => this.toJob(item));
        }
        return result;
    }

    private keyName(bufferId: string) {
        return `${this.prefix}${BUFFER_LIST_PREFIX}:${bufferId}`;
    }

    private toJobConfigString(job: Job<any>): string {
        const jobConfig: JobConfig<any> = {
            queueName: job.queueName,
            data: job.data,
            retries: job.retries,
            attempts: job.attempts,
            state: job.state,
            progress: job.progress,
            result: job.result,
            error: job.error,
            createdAt: job.createdAt,
            startedAt: job.startedAt,
            settledAt: job.settledAt,
            id: job.id ?? undefined,
        };
        return JSON.stringify(jobConfig);
    }

    private toJob(jobConfigString: string): Job {
        try {
            const jobConfig: JobConfig<any> = JSON.parse(jobConfigString);
            return new Job(jobConfig);
        } catch (e: any) {
            Logger.error(`Could not parse buffered job:\n${JSON.stringify(e.message)}`, loggerCtx, e.stack);
            throw e;
        }
    }

    private async getAllBufferIds(): Promise<string[]> {
        const keyPrefix = `${this.prefix}${BUFFER_LIST_PREFIX}:`;
        const stream =
            this.redis instanceof Redis
                ? this.redis.scanStream({ match: `${keyPrefix}*` })
                : this.redis.nodes()[0].scanStream({ match: `${keyPrefix}*` });
        const keys = await new Promise<string[]>((resolve, reject) => {
            const allKeys: string[] = [];
            stream.on('data', _keys => allKeys.push(..._keys));
            stream.on('end', () => resolve(allKeys));
            stream.on('error', err => reject(err));
        });

        return keys.map(key => key.replace(keyPrefix, ''));
    }
}
