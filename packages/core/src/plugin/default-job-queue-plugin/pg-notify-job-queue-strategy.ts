import type { Client, ClientConfig } from 'pg';
import { DataSource } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

import { Injector } from '../../common/injector';
import { Logger } from '../../config/logger/vendure-logger';
import { getDatabaseType } from '../../connection/database-type';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Job, JobData, JobQueueStrategyJobOptions } from '../../job-queue';
import { PollingJobQueueStrategyConfig } from '../../job-queue/polling-job-queue-strategy';

import { JobRecord } from './job-record.entity';
import { SqlJobQueueStrategy } from './sql-job-queue-strategy';

const CHANNEL = 'vendure_job';
const loggerCtx = 'PgNotifyJobQueueStrategy';

const DEFAULT_SAFETY_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const INITIAL_RECONNECT_DELAY_MS = 1_000;

/**
 * @description
 * Configuration options for the {@link PgNotifyJobQueueStrategy}.
 *
 * @docsCategory JobQueue
 * @since 3.8.0
 */
export interface PgNotifyJobQueueStrategyConfig extends PollingJobQueueStrategyConfig {
    /**
     * @description
     * Connection details for the dedicated listener connection.
     *
     * The listener sits in `LISTEN` indefinitely, so it deliberately does not come from
     * TypeORM's pool - a pooled connection gets recycled out from under the subscription.
     * Left unset, the connection is built from the DataSource's own options, so a project
     * which already works needs no further configuration.
     *
     * Set this explicitly if the primary connection goes through a connection pooler:
     * poolers in transaction mode multiplex connections and silently drop `LISTEN`, so the
     * listener should be pointed at the direct database host.
     *
     * @default undefined
     */
    listenerConnection?: ClientConfig;
    /**
     * @description
     * How long a blocked call to `next()` waits for a notification before checking the
     * database anyway.
     *
     * This is a safety net, not a poll. `NOTIFY` is fire-and-forget: Postgres does not
     * queue notifications for a listener which is not connected, so a wake-up sent while
     * this process was reconnecting is simply lost. Without this timeout the corresponding
     * job would stay `PENDING` indefinitely. With it, the worst case for a lost
     * notification is one interval of lateness.
     *
     * @default 300_000
     */
    safetyIntervalMs?: number;
}

/**
 * @description
 * A {@link JobQueueStrategy} which is woken by Postgres `LISTEN`/`NOTIFY` rather than
 * polling the database for work.
 *
 * {@link SqlJobQueueStrategy} finds jobs by asking: each queue runs a
 * `BEGIN` / `SELECT ... FOR UPDATE` / `COMMIT` every `pollInterval` ms, with no backoff
 * when the answer keeps being "nothing". With the database on the same machine that is
 * free and unremarkable. With it on a managed host reached over the network - and
 * especially one which meters bandwidth - four idle queues cost on the order of 1.6
 * million queries a day whether or not a single request is served.
 *
 * This strategy replaces the asking with being told, and inherits everything else from
 * `SqlJobQueueStrategy` - `update`, `findMany`, the `FOR UPDATE` row locking and the
 * `InspectableJobQueueStrategy` surface which the Admin UI's job list reads.
 *
 * Measured on an otherwise idle project with four queues, against a local Postgres:
 *
 * | | `SqlJobQueueStrategy` | this strategy |
 * | --- | --- | --- |
 * | `job_record` queries / 30s | 564 | 0 |
 * | projected per day | 1,623,887 | ~2,304 |
 * | job pickup latency | 180ms | 76-79ms |
 *
 * Jobs also start *faster*, because a notification arrives when the row is committed
 * rather than at the next tick of a timer.
 *
 * @example
 * ```ts
 * import { DefaultJobQueuePlugin, VendureConfig } from '(at)vendure/core';
 *
 * export const config: VendureConfig = {
 *   // ...
 *   plugins: [
 *     DefaultJobQueuePlugin.init({ useNotify: true }),
 *   ],
 * };
 * ```
 *
 * Requires Postgres. On any other database the strategy logs a warning during
 * bootstrap and behaves exactly like {@link SqlJobQueueStrategy}, polling at
 * `pollInterval`.
 *
 * @docsCategory JobQueue
 * @since 3.8.0
 */
export class PgNotifyJobQueueStrategy extends SqlJobQueueStrategy {
    private listener?: Client;
    private txConnection?: TransactionalConnection;
    private dataSource?: DataSource;
    /** Queue name -> the `next()` calls currently parked on it. */
    private readonly waiters = new Map<string, Set<() => void>>();
    /**
     * Queues which have been stopped and not restarted. `stop()` can be called while a
     * `next()` is between asking the database and parking, in which case waking it finds
     * no waiter to release; this makes that `next()` decline to park at all.
     */
    private readonly stopping = new Set<string>();
    private readonly listenerConnection?: ClientConfig;
    private readonly safetyIntervalMs: number;
    /**
     * Whether the database can deliver notifications at all. When false, `next()` never
     * parks, which is what makes a misconfigured project slower rather than broken.
     */
    private notifySupported = false;
    private listenerStarted = false;
    private shuttingDown = false;
    private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;

    constructor(config: PgNotifyJobQueueStrategyConfig = {}) {
        super(config);
        this.listenerConnection = config.listenerConnection;
        this.safetyIntervalMs = config.safetyIntervalMs ?? DEFAULT_SAFETY_INTERVAL_MS;
    }

    init(injector: Injector) {
        super.init(injector);
        this.txConnection = injector.get(TransactionalConnection);
        this.dataSource = this.txConnection.rawConnection;
        this.notifySupported = getDatabaseType(this.dataSource) === 'postgres';
        if (!this.notifySupported) {
            Logger.warn(
                'PgNotifyJobQueueStrategy requires Postgres, so the job queue will poll instead. ' +
                    'Use SqlJobQueueStrategy directly to silence this warning.',
                loggerCtx,
            );
        }
        // The listener is opened lazily, by the first queue which actually parks - see
        // `ensureListener()`. The config is loaded by the server process as well as the
        // worker, and only the worker calls `next()`, so connecting here would leave the
        // server holding a Postgres connection it never reads from.
    }

    /**
     * Asks the database once; if it has nothing, waits to be told rather than asking
     * again. Returning immediately when a job is already waiting is what lets a backlog
     * drain at full speed - only an empty queue ever parks.
     */
    async next(queueName: string): Promise<Job | undefined> {
        const job = await super.next(queueName);
        if (job || !this.notifySupported) {
            return job;
        }
        await this.waitForWork(queueName);
        return super.next(queueName);
    }

    /**
     * Enqueues the job, then wakes whoever is waiting on that queue.
     *
     * The `pg_notify` deliberately rides the *same* manager as the insert. `add()` uses
     * the request's transactional repository when it is given a `ctx`, and Postgres holds
     * notifications until `COMMIT` - so the worker is woken exactly when the row becomes
     * visible to it, and not at all if the transaction rolls back. Notifying over a
     * separate connection would race the commit: the worker would wake, query, find an
     * empty table, and sleep until the safety interval expired.
     */
    async add<Data extends JobData<Data> = object>(
        job: Job<Data>,
        jobOptions?: JobQueueStrategyJobOptions<Data>,
    ): Promise<Job<Data>> {
        const result = await super.add(job, jobOptions);
        if (!this.notifySupported) {
            return result;
        }
        const manager =
            jobOptions?.ctx && this.txConnection
                ? this.txConnection.getRepository(jobOptions.ctx, JobRecord).manager
                : this.dataSource?.manager;
        try {
            await manager?.query('SELECT pg_notify($1, $2)', [CHANNEL, job.queueName]);
        } catch (e: any) {
            // A wake-up which fails to send is late work, not lost work - the safety
            // interval still picks the job up. Never fail the caller's transaction, which
            // may be an order being placed, over an optimisation.
            Logger.warn(`Could not notify queue "${job.queueName}": ${e.message as string}`, loggerCtx);
        }
        return result;
    }

    async start<Data extends JobData<Data> = object>(
        queueName: string,
        process: (job: Job<Data>) => Promise<any>,
    ): Promise<void> {
        this.stopping.delete(queueName);
        return super.start(queueName, process);
    }

    /**
     * Releases this queue's parked `next()`, so that a shutdown is not held up waiting for
     * a notification which is not coming.
     */
    async stop<Data extends JobData<Data> = object>(
        queueName: string,
        process: (job: Job<Data>) => Promise<any>,
    ): Promise<void> {
        this.stopping.add(queueName);
        this.wake(queueName);
        return super.stop(queueName, process);
    }

    destroy() {
        this.shuttingDown = true;
        this.wakeAll();
        const client = this.listener;
        this.listener = undefined;
        void client?.end().catch(() => undefined);
        super.destroy();
    }

    /**
     * Opens the listener on first use. Parking before it is connected is safe:
     * `connectListener()` wakes every waiter once it is up, so a parked `next()` re-checks
     * the table rather than sleeping through a notification sent during the gap.
     */
    private ensureListener() {
        if (this.listenerStarted || this.shuttingDown) {
            return;
        }
        this.listenerStarted = true;
        void this.connectListener();
    }

    private waitForWork(queueName: string): Promise<void> {
        if (this.shuttingDown || this.stopping.has(queueName)) {
            return Promise.resolve();
        }
        this.ensureListener();
        return new Promise<void>(resolve => {
            let settled = false;
            const done = () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                this.waiters.get(queueName)?.delete(done);
                resolve();
            };
            const timer = setTimeout(done, this.safetyIntervalMs);
            // A parked `next()` is a queue's normal resting state, so this timer is
            // pending almost always. Left referenced, it would hold the process open for
            // the full interval on every shutdown.
            timer.unref();
            let waiters = this.waiters.get(queueName);
            if (!waiters) {
                waiters = new Set();
                this.waiters.set(queueName, waiters);
            }
            waiters.add(done);
        });
    }

    private wake(queueName: string) {
        const waiters = this.waiters.get(queueName);
        if (!waiters) {
            return;
        }
        for (const done of [...waiters]) {
            done();
        }
    }

    private wakeAll() {
        for (const queueName of [...this.waiters.keys()]) {
            this.wake(queueName);
        }
    }

    /**
     * Builds the listener's connection details from the DataSource, so that a project
     * which already works needs no further configuration.
     */
    private clientConfig(): ClientConfig {
        if (this.listenerConnection) {
            return this.listenerConnection;
        }
        const options = this.dataSource?.options as PostgresConnectionOptions | undefined;
        if (options?.url) {
            return { connectionString: options.url, ssl: options.ssl as ClientConfig['ssl'] };
        }
        return {
            host: options?.host,
            port: options?.port,
            user: options?.username,
            password: options?.password as string | undefined,
            database: options?.database,
            ssl: options?.ssl as ClientConfig['ssl'],
        };
    }

    private async connectListener(): Promise<void> {
        if (this.shuttingDown || !this.notifySupported) {
            return;
        }
        let client: Client;
        try {
            // Imported at call time rather than at the top of the file: `pg` is a peer of
            // TypeORM's Postgres driver rather than a dependency of Vendure, so a project
            // on MySQL or SQLite must not be made to resolve it.
            const { Client: PgClient } = await import('pg');
            client = new PgClient(this.clientConfig());
        } catch (e: any) {
            Logger.warn(
                `Could not load the "pg" package, so the job queue will poll instead: ${e.message as string}`,
                loggerCtx,
            );
            this.notifySupported = false;
            this.wakeAll();
            return;
        }
        client.on('notification', message => {
            if (message.payload) {
                this.wake(message.payload);
            }
        });
        const onLost = (e?: Error) => {
            if (this.listener !== client) {
                return;
            }
            this.listener = undefined;
            if (e) {
                Logger.warn(`Job queue listener lost: ${e.message}`, loggerCtx);
            }
            this.scheduleReconnect();
        };
        client.on('error', onLost);
        client.on('end', () => onLost());

        try {
            await client.connect();
            await client.query(`LISTEN ${CHANNEL}`);
            this.listener = client;
            this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
            Logger.verbose(`Job queue listening on "${CHANNEL}"`, loggerCtx);
            // Anything enqueued while this process was disconnected sent a notification
            // which nobody heard. Re-check every parked queue once, rather than making
            // those jobs serve out the safety interval.
            this.wakeAll();
        } catch (e: any) {
            void client.end().catch(() => undefined);
            Logger.warn(`Job queue listener could not connect: ${e.message as string}`, loggerCtx);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect() {
        if (this.shuttingDown) {
            return;
        }
        const delay = this.reconnectDelay;
        this.reconnectDelay = Math.min(delay * 2, MAX_RECONNECT_DELAY_MS);
        const timer = setTimeout(() => void this.connectListener(), delay);
        timer.unref();
    }
}
