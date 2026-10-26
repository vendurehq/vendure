import { Job } from '../job';

import { InMemoryJobBufferStorageStrategy } from './in-memory-job-buffer-storage-strategy';

/**
 * This strategy is only intended to be used for automated testing.
 */
export class TestingJobBufferStorageStrategy extends InMemoryJobBufferStorageStrategy {
    /**
     * Discards all buffered jobs, so a spec file sharing this instance does not carry
     * buffers from one test into the next.
     */
    reset() {
        this.bufferStorage.clear();
    }

    getBufferedJobs(bufferId: string): Job[] {
        return Array.from(this.bufferStorage.get(bufferId) ?? []);
    }
}
