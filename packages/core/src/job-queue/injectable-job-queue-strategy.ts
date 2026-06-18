import { Injector } from '../common';

import { Job } from './job';
import { JobData } from './types';

type ProcessFunc<Data extends JobData<Data> = object> = (job: Job<Data>) => Promise<any>;

/**
 * @description
 * This is a helper class for implementations of {@link JobQueueStrategy} that need to
 * have init called before they can start a queue.
 * It simply collects calls to {@link JobQueueStrategy} `start()` and calls `start()` again after init.
 * When using the class `start()` should start with this snippet
 *
 * ```
 * Typescript
 * if (!this.hasInitialized) {
 *   this.started.set(queueName, process);
 *   return;
 * }
 * ```
 */
export abstract class InjectableJobQueueStrategy {
    protected started = new Map<string, ProcessFunc<any>>();
    protected hasInitialized = false;

    init(injector: Injector) {
        this.hasInitialized = true;
        for (const [queueName, process] of this.started) {
            this.start(queueName, process);
        }
        this.started.clear();
    }

    destroy() {
        this.hasInitialized = false;
    }

    abstract start<Data extends JobData<Data> = object>(
        queueName: string,
        process: (job: Job<Data>) => Promise<any>,
    ): void;
}
