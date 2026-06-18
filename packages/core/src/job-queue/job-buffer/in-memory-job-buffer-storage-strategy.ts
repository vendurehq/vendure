import { Job } from '../job';

import { JobBufferStorageStrategy } from './job-buffer-storage-strategy';

/**
 * @description
 * A {@link JobBufferStorageStrategy} which keeps the buffered jobs in memory. Should
 * _not_ be used in production, since it will lose data in the event of the server
 * stopping.
 *
 * Instead, use the {@link DefaultJobQueuePlugin} with the `useDatabaseForBuffer: true` option set,
 * or the {@link BullMQJobQueuePlugin} or another custom strategy with persistent storage.
 *
 * @since 1.3.0
 * @docsCategory JobQueue
 */
export class InMemoryJobBufferStorageStrategy implements JobBufferStorageStrategy {
    protected bufferStorage = new Map<string, Set<Job>>();

    async add(bufferId: string, job: Job): Promise<Job> {
        const set = this.getSet(bufferId);
        set.add(job);
        return job;
    }

    async bufferSize(bufferIds?: string[]): Promise<{ [bufferId: string]: number }> {
        const ids = bufferIds ?? Array.from(this.bufferStorage.keys());
        const result: { [bufferId: string]: number } = {};
        for (const id of ids) {
            const size = this.bufferStorage.get(id)?.size ?? 0;
            result[id] = size;
        }
        return result;
    }

    async flush(bufferIds?: string[]): Promise<{ [bufferId: string]: Job[] }> {
        const ids = bufferIds ?? Array.from(this.bufferStorage.keys());
        const result: { [processorId: string]: Job[] } = {};
        for (const id of ids) {
            const jobs = Array.from(this.bufferStorage.get(id) ?? []);
            this.bufferStorage.get(id)?.clear();
            result[id] = jobs;
        }
        return result;
    }

    private getSet(bufferId: string): Set<Job> {
        const set = this.bufferStorage.get(bufferId);
        if (set) {
            return set;
        } else {
            const newSet = new Set<Job>();
            this.bufferStorage.set(bufferId, newSet);
            return newSet;
        }
    }
}
