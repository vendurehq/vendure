import { JobState } from '@vendure/common/lib/generated-types';
import { isClassInstance, isObject } from '@vendure/common/lib/shared-utils';

import { Logger } from '../config/logger/vendure-logger';

import { JobConfig, JobData } from './types';

/**
 * @description
 * An event raised by a Job.
 *
 * @docsCategory JobQueue
 * @docsPage Job
 */
export type JobEventType = 'progress';

/**
 * @description
 * The signature of the event handler expected by the `Job.on()` method.
 *
 * @docsCategory JobQueue
 * @docsPage Job
 */
export type JobEventListener<T extends JobData<T>> = (job: Job<T>) => void;

/**
 * @description
 * A Job represents a piece of work to be run in the background, i.e. outside the request-response cycle.
 * It is intended to be used for long-running work triggered by API requests. Jobs should now generally
 * be directly instantiated. Rather, the {@link JobQueue} `add()` method should be used to create and
 * add a new Job to a queue.
 *
 * @docsCategory JobQueue
 * @docsPage Job
 * @docsWeight 0
 */
export class Job<T extends JobData<T> = any> {
    readonly id: number | string | null;
    readonly queueName: string;
    readonly retries: number;
    readonly createdAt: Date;
    private readonly _data: T;
    private _state: JobState;
    private _progress: number;
    private _result?: any;
    private _error?: any;
    private _attempts: number;
    private _startedAt?: Date;
    private _settledAt?: Date;
    private readonly eventListeners: { [type in JobEventType]: Array<JobEventListener<T>> } = {
        progress: [],
    };

    get name(): string {
        return this.queueName;
    }

    get data(): T {
        return this._data;
    }

    get state(): JobState {
        return this._state;
    }

    get progress(): number {
        return this._progress;
    }

    get result(): any {
        return this._result;
    }

    get error(): any {
        return this._error;
    }

    get isSettled(): boolean {
        return (
            !!this._settledAt &&
            (this._state === JobState.COMPLETED ||
                this._state === JobState.FAILED ||
                this._state === JobState.CANCELLED)
        );
    }

    get startedAt(): Date | undefined {
        return this._startedAt;
    }

    get settledAt(): Date | undefined {
        return this._settledAt;
    }

    get duration(): number {
        if (this.state === JobState.PENDING || this.state === JobState.RETRYING) {
            return 0;
        }
        const end = this._settledAt || new Date();
        return +end - +(this._startedAt || end);
    }

    get attempts(): number {
        return this._attempts;
    }

    constructor(config: JobConfig<T>) {
        this.queueName = config.queueName;
        this._data = this.ensureDataIsSerializable(config.data);
        this.id = config.id || null;
        this._state = config.state || JobState.PENDING;
        this.retries = config.retries || 0;
        this._attempts = config.attempts || 0;
        this._progress = config.progress || 0;
        this.createdAt = config.createdAt || new Date();
        this._result = config.result;
        this._error = config.error;
        this._startedAt = config.startedAt;
        this._settledAt = config.settledAt;
    }

    /**
     * @description
     * Calling this signifies that the job work has started. This method should be
     * called in the {@link JobQueueStrategy} `next()` method.
     */
    start() {
        if (this._state === JobState.PENDING || this._state === JobState.RETRYING) {
            this._state = JobState.RUNNING;
            this._startedAt = new Date();
            this._attempts++;
            Logger.debug(
                `Job ${this.id?.toString() ?? 'null'} [${this.queueName}] starting (attempt ${
                    this._attempts
                } of ${this.retries + 1})`,
            );
        }
    }

    /**
     * @description
     * Sets the progress (0 - 100) of the job.
     */
    setProgress(percent: number) {
        this._progress = Math.min(percent || 0, 100);
        this.fireEvent('progress');
    }

    /**
     * @description
     * Calling this method signifies that the job succeeded. The result
     * will be stored in the `Job.result` property.
     */
    complete(result?: any) {
        this._result = result;
        this._progress = 100;
        this._state = JobState.COMPLETED;
        this._settledAt = new Date();
        Logger.debug(`Job ${this.id?.toString() ?? 'null'} [${this.queueName}] completed`);
    }

    /**
     * @description
     * Calling this method signifies that the job failed.
     */
    fail(err?: any) {
        this._error = err?.message ? err.message : String(err);
        this._progress = 0;
        if (this.retries >= this._attempts) {
            this._state = JobState.RETRYING;
            Logger.warn(
                `Job ${this.id?.toString() ?? 'null'} [${this.queueName}] failed (attempt ${
                    this._attempts
                } of ${this.retries + 1})`,
            );
        } else {
            if (this._state !== JobState.CANCELLED) {
                this._state = JobState.FAILED;
                Logger.warn(
                    `Job ${this.id?.toString() ?? 'null'} [${this.queueName}] failed and will not retry.`,
                );
            }
            this._settledAt = new Date();
        }
    }

    cancel() {
        this._settledAt = new Date();
        this._state = JobState.CANCELLED;
    }

    /**
     * @description
     * Sets a RUNNING job back to PENDING. Should be used when the JobQueue is being
     * destroyed before the job has been completed.
     */
    defer() {
        if (this._state === JobState.RUNNING) {
            this._state = JobState.PENDING;
            this._attempts = 0;
            Logger.debug(
                `Job ${this.id?.toString() ?? 'null'} [${this.queueName}] deferred back to PENDING state`,
            );
        }
    }

    /**
     * @description
     * Used to register event handler for job events
     */
    on(eventType: JobEventType, listener: JobEventListener<T>) {
        this.eventListeners[eventType].push(listener);
    }

    off(eventType: JobEventType, listener: JobEventListener<T>) {
        const idx = this.eventListeners[eventType].indexOf(listener);
        if (idx !== -1) {
            this.eventListeners[eventType].splice(idx, 1);
        }
    }

    private fireEvent(eventType: JobEventType) {
        for (const listener of this.eventListeners[eventType]) {
            listener(this);
        }
    }

    /**
     * All data in a job must be serializable. This method handles certain problem cases such as when
     * the data is a class instance with getters. Even though technically the "data" object should
     * already be serializable per the TS type, in practice data can slip through due to loss of
     * type safety.
     */
    private ensureDataIsSerializable(
        data: any,
        depth = 0,
        seen = new WeakMap<any, string[]>(),
        path: string[] = [],
    ): any {
        if (10 < depth) {
            return '[max depth reached]';
        }
        if (data === null || data === undefined) {
            return data;
        }
        // Handle Date objects
        if (data instanceof Date) {
            return data.toISOString();
        }

        if (typeof data === 'object' && data !== null) {
            const seenData = seen.get(data);
            if (seenData && seenData.length < path.length) {
                return `[circular *${path.join('.')}]`;
            }
            seen.set(data, path);
        }

        depth++;
        let output: any;
        if (isObject(data)) {
            output = {};
            // If the object has a `.toJSON()` function defined, then
            // prefer it to any other type of serialization.
            if (this.hasToJSONFunction(data)) {
                output = data.toJSON();
            } else {
                for (const key of Object.keys(data)) {
                    output[key] = this.ensureDataIsSerializable(
                        (data as any)[key],
                        depth,
                        seen,
                        path.concat(key),
                    );
                }
                if (isClassInstance(data)) {
                    const descriptors = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(data));
                    for (const name of Object.keys(descriptors)) {
                        const descriptor = descriptors[name];
                        if (typeof descriptor.get === 'function') {
                            output[name] = (data as any)[name];
                        }
                    }
                }
            }
        } else if (Array.isArray(data)) {
            if (!output) {
                output = [];
            }
            data.forEach((item, i) => {
                output[i] = this.ensureDataIsSerializable(item, depth, seen, path.concat(i.toString()));
            });
        } else {
            return data;
        }
        return output;
    }

    private hasToJSONFunction(obj: any): obj is { toJSON(): any } {
        return typeof obj?.toJSON === 'function';
    }
}
