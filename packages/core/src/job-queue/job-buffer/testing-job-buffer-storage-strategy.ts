import { Job } from '../job';

import { InMemoryJobBufferStorageStrategy } from './in-memory-job-buffer-storage-strategy';

/**
 * This strategy is only intended to be used for automated testing.
 */
export class TestingJobBufferStorageStrategy extends InMemoryJobBufferStorageStrategy {
    getBufferedJobs(bufferId: string): Job[] {
        return Array.from(this.bufferStorage.get(bufferId) ?? []);
    }
}
