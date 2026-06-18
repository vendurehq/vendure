export type Task<T = any> = () => Promise<T> | T;
export type Resolve<T> = (val: T) => void;
export type Reject<T> = (val: T) => void;
type TaskQueueItem = { task: Task; resolve: Resolve<any>; reject: Reject<any> };

/**
 * @description
 * A queue class for limiting concurrent async tasks. This can be used e.g. to prevent
 * race conditions when working on a shared resource such as writing to a database.
 *
 * @docsCategory common
 */
export class AsyncQueue {
    private static running: { [label: string]: number } = {};
    private static taskQueue: { [label: string]: TaskQueueItem[] } = {};

    constructor(private label: string = 'default', private concurrency: number = 1) {
        if (!AsyncQueue.taskQueue[label]) {
            AsyncQueue.taskQueue[label] = [];
            AsyncQueue.running[label] = 0;
        }
    }

    private get running(): number {
        return AsyncQueue.running[this.label];
    }

    private inc() {
        AsyncQueue.running[this.label]++;
    }

    private dec() {
        AsyncQueue.running[this.label]--;
    }

    /**
     * @description
     * Pushes a new task onto the queue, upon which the task will either execute immediately or
     * (if the number of running tasks is equal to the concurrency limit) enqueue the task to
     * be executed at the soonest opportunity.
     */
    push<T>(task: Task<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            void (this.running < this.concurrency
                ? this.runTask(task, resolve, reject)
                : this.enqueueTask(task, resolve, reject));
        });
    }

    private async runTask<T>(task: Task<T>, resolve: Resolve<T>, reject: Reject<T>) {
        this.inc();
        try {
            const result = await task();
            resolve(result);
        } catch (e: any) {
            reject(e);
        }
        this.dec();
        if (this.getQueue().length > 0) {
            const nextTask = this.getQueue().shift();
            if (nextTask) {
                await this.runTask(nextTask.task, nextTask.resolve, nextTask.reject);
            }
        }
    }

    private enqueueTask<T>(task: Task<T>, resolve: Resolve<T>, reject: Reject<T>) {
        this.getQueue().push({ task, resolve, reject });
    }

    private getQueue(): TaskQueueItem[] {
        return AsyncQueue.taskQueue[this.label];
    }
}
