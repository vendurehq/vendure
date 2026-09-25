import { InMemoryJobQueueStrategy } from './in-memory-job-queue-strategy';
import { Job } from './job';
import { JobData } from './types';

/**
 * @description
 * An in-memory {@link JobQueueStrategy} design for testing purposes.
 */
export class TestingJobQueueStrategy extends InMemoryJobQueueStrategy {
    /**
     * Discards all stored and queued jobs. The strategy is shared across a spec file, and
     * `destroy()` does not clear it, so a suite that does not call this inherits the jobs
     * left behind by the test before it.
     */
    reset() {
        this.jobs.clear();
        this.unsettledJobs = {};
    }

    async prePopulate(jobs: Job[]) {
        for (const job of jobs) {
            await this.add(job);
        }
    }

    override async stop<Data extends JobData<Data> = object>(
        queueName: string,
        process: (job: Job<Data>) => Promise<any>,
    ) {
        const active = this.activeQueues.getAndDelete(queueName, process);
        if (!active) {
            return;
        }
        await active.stop(1_000);
    }
}
