import { InMemoryJobQueueStrategy } from './in-memory-job-queue-strategy';
import { Job } from './job';
import { JobData } from './types';

/**
 * @description
 * An in-memory {@link JobQueueStrategy} design for testing purposes.
 */
export class TestingJobQueueStrategy extends InMemoryJobQueueStrategy {
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
