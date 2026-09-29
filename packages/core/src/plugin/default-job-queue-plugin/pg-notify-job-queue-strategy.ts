import { JobState } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { randomUUID } from 'crypto';
import type { Client, Notification } from 'pg';
import type { ConnectionOptions } from 'tls';
import { DataSource, EntityManager } from 'typeorm';
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
const PROBE_TIMEOUT_MS = 3_000;
/** Not a valid queue name in practice, so `wake()` finds no waiters for it. */
const PROBE_PREFIX = '__vendure_job_probe__:';
/**
 * How long a retry is still tracked after its backoff has elapsed. `SqlJobQueueStrategy`
 * compares the backoff against the row's `updatedAt`, which is set by the database clock,
 * so a retry can become due slightly later than this process expects.
 */
const RETRY_GRACE_MS = 5_000;
const MIN_RETRY_WAIT_MS = 50;
/**
 * The listener is idle most of the time. Without keepalive packets a NAT or load balancer
 * can drop the connection without a reset, and the client never notices it is gone.
 */
const LISTENER_KEEPALIVE: PgNotifyListenerConnection = {
    keepAlive: true,
    keepAliveInitialDelayMillis: 60_000,
};

/**
 * @description
 * Connection details for the listener of the {@link PgNotifyJobQueueStrategy}. These are
 * passed to the `pg` package's `Client`, which also accepts its other `ClientConfig`
 * options.
 *
 * @docsCategory JobQueue
 * @since 3.8.0
 */
export interface PgNotifyListenerConnection {
    connectionString?: string;
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
    ssl?: boolean | ConnectionOptions;
    application_name?: string;
    keepAlive?: boolean;
    keepAliveInitialDelayMillis?: number;
    [option: string]: unknown;
}

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
     * Connection details for the listener connection.
     *
     * The listener holds one connection open in `LISTEN` for as long as the worker runs,
     * separate from TypeORM's pool. When this option is not set, the connection details
     * are taken from `dbConnectionOptions`, including `replication.master` and `extra`.
     *
     * Set this option when `dbConnectionOptions` points at a connection pooler in
     * transaction mode, such as PgBouncer, Supavisor, or the pooled endpoint of Neon or
     * Supabase. Such a pooler accepts `LISTEN` but never delivers notifications. Point the
     * listener at the direct database host, or at a pooler port in session mode.
     *
     * On connect, the listener sends itself a test notification. If it does not arrive
     * within 3 seconds, the strategy logs a warning and the queues poll at `pollInterval`
     * until the process restarts.
     *
     * @default undefined
     */
    listenerConnection?: PgNotifyListenerConnection;
    /**
     * @description
     * The longest time a queue waits for a notification before it checks the database
     * again.
     *
     * Postgres does not store notifications for a listener which is disconnected. A job
     * whose notification was missed, for example one retried by a worker which has since
     * exited, is picked up at the latest after this interval.
     *
     * @default 300_000
     */
    safetyIntervalMs?: number;
}

/**
 * @description
 * A {@link JobQueueStrategy} which waits for Postgres `LISTEN`/`NOTIFY` instead of
 * polling the database for jobs. It extends {@link SqlJobQueueStrategy}, so jobs are
 * stored, locked and listed in the Admin UI in the same way.
 *
 * When a queue has no job, `next()` waits until one of these happens:
 *
 * - `add()` commits a job to that queue. The notification is sent in the same
 *   transaction as the insert, so it arrives on commit and never on rollback.
 * - A job on that queue is returned to `PENDING`, for example by a worker shutting down.
 * - A retry which this worker scheduled becomes due.
 * - The listener connection is lost.
 * - `safetyIntervalMs` passes.
 *
 * While the listener is not connected, queues poll at `pollInterval`, backing off up to
 * `maxIdlePollInterval` if it is set.
 *
 * Each `add()` makes one extra database round trip to send the notification.
 *
 * @example
 * ```ts
 * import { DefaultJobQueuePlugin, VendureConfig } from '\@vendure/core';
 *
 * export const config: VendureConfig = {
 *   // ...
 *   plugins: [
 *     DefaultJobQueuePlugin.init({ useNotify: true }),
 *   ],
 * };
 * ```
 *
 * If `dbConnectionOptions` points at a connection pooler in transaction mode, set
 * `listenerConnection` to the direct database host. See
 * {@link PgNotifyJobQueueStrategyConfig}.
 *
 * Requires Postgres. On any other database the strategy logs a warning during
 * bootstrap and behaves like {@link SqlJobQueueStrategy}.
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
     * Queues which have been stopped and not restarted. `stop()` can run while a `next()`
     * is between its query and parking, so `wake()` finds nothing to release. A `next()`
     * on a queue in this set does not park.
     */
    private readonly stopping = new Set<string>();
    private readonly listenerConnection?: PgNotifyListenerConnection;
    private readonly safetyIntervalMs: number;
    /**
     * Whether the database can deliver notifications at all. When false, `next()` never
     * parks and the queues poll. Parking on a database which never notifies would leave
     * every job waiting for the safety interval.
     */
    private notifySupported = false;
    /**
     * Queues which were woken while nothing was parked on them. The next `next()` to park
     * on such a queue re-checks the table immediately instead, so a notification which
     * arrives between asking the database and parking is not lost.
     */
    private readonly pendingWakes = new Set<string>();
    /**
     * Jobs this process has set to `RETRYING`, and when their backoff elapses. Nothing
     * notifies when a backoff elapses, so a queue with a pending retry parks only until
     * the retry is due.
     */
    private readonly retries = new Map<ID, { queueName: string; dueAt: number }>();
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
        // The first `next()` opens the listener, through `ensureListener()`. The server
        // process also calls `init()`, but only the worker calls `next()`. Connecting here
        // would give the server a Postgres connection which it never reads from.
    }

    /**
     * Queries the database once. If there is no job, parks until a notification or a
     * timeout, then queries once more. A job found by the first query is returned
     * immediately, so a backlog drains at the same speed as with polling.
     */
    async next(queueName: string): Promise<Job | undefined> {
        const job = await super.next(queueName);
        if (job || !this.notifySupported) {
            return job;
        }
        if (!this.listener) {
            // Until the listener is connected, and whenever it is down, a notification
            // would go unheard, so the queue polls at `pollInterval` instead of parking.
            this.ensureListener();
            return undefined;
        }
        await this.waitForWork(queueName);
        if (this.shuttingDown || this.stopping.has(queueName)) {
            // `ActiveQueue.stop()` has already stopped tracking jobs, so a job claimed now
            // would be left `RUNNING`.
            return undefined;
        }
        return super.next(queueName);
    }

    async update(job: Job<any>): Promise<void> {
        await super.update(job);
        if (job.state === JobState.PENDING && this.notifySupported) {
            // A job goes back to PENDING when `Job.defer()` hands it back at shutdown, and
            // nothing else would tell the other workers it is available again.
            await this.notify(job.queueName, this.dataSource?.manager);
        }
        if (job.id == null) {
            return;
        }
        if (job.state === JobState.RETRYING && this.backOffStrategy) {
            const delay = this.backOffStrategy(job.queueName, job.attempts, job);
            this.retries.set(job.id, { queueName: job.queueName, dueAt: Date.now() + delay });
            // With concurrency above 1, another slot may already be parked with a longer
            // timeout. Waking it makes it re-park with the retry's timeout.
            this.wake(job.queueName, false);
        } else {
            this.retries.delete(job.id);
        }
    }

    /**
     * Inserts the job, then sends a notification for its queue.
     *
     * The `pg_notify` runs on the same `EntityManager` as the insert. With a `ctx`, that
     * is the request's transaction. Postgres delivers the notification on `COMMIT`, when
     * the row becomes visible to the worker, and discards it on rollback. A notification
     * sent over a separate connection could arrive before the commit. The worker would
     * then find no job and park until the safety interval.
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
        await this.notify(job.queueName, manager);
        return result;
    }

    private async notify(queueName: string, manager?: EntityManager) {
        try {
            await manager?.query('SELECT pg_notify($1, $2)', [CHANNEL, queueName]);
        } catch (e: any) {
            // If the notification is not sent, the job starts at the latest after the safety
            // interval. `pg_notify` fails only on an invalid channel or a payload over 8000
            // bytes, and a queue name causes neither. In practice this catches a lost
            // connection. Postgres reports a full notification queue at `COMMIT`, outside
            // this call.
            Logger.warn(`Could not notify queue "${queueName}": ${e.message as string}`, loggerCtx);
        }
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
     * Opens the listener on first use. Queues poll until it is connected.
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
        if (this.pendingWakes.delete(queueName)) {
            return Promise.resolve();
        }
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
            const timer = setTimeout(done, this.parkTimeout(queueName));
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

    /**
     * The safety interval, or less if a job this process set to `RETRYING` on this queue
     * becomes due sooner.
     */
    private parkTimeout(queueName: string): number {
        const now = Date.now();
        let timeout = this.safetyIntervalMs;
        for (const [id, retry] of this.retries) {
            if (now > retry.dueAt + RETRY_GRACE_MS) {
                // Picked up by another worker, or not due by the database's clock either.
                this.retries.delete(id);
            } else if (retry.queueName === queueName) {
                timeout = Math.min(timeout, Math.max(retry.dueAt - now, MIN_RETRY_WAIT_MS));
            }
        }
        return timeout;
    }

    /**
     * Releases the `next()` calls parked on a queue. With `remember`, a wake-up which finds
     * nothing parked is kept for the next call to park.
     */
    private wake(queueName: string, remember = true) {
        const waiters = this.waiters.get(queueName);
        if (!waiters?.size) {
            if (remember) {
                this.pendingWakes.add(queueName);
            }
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
    private clientConfig(): PgNotifyListenerConnection {
        if (this.listenerConnection) {
            return { ...LISTENER_KEEPALIVE, ...this.listenerConnection };
        }
        const options = this.dataSource?.options as PostgresConnectionOptions | undefined;
        // Mirrors how TypeORM's Postgres driver builds its pool config: credentials from
        // the replication master if there is one, then `extra` on top.
        const credentials = options?.replication?.master ?? options;
        return {
            connectionString: credentials?.url,
            host: credentials?.host,
            port: credentials?.port,
            user: credentials?.username,
            password: credentials?.password as string | undefined,
            database: credentials?.database,
            ssl: credentials?.ssl as PgNotifyListenerConnection['ssl'],
            application_name: options?.applicationName,
            ...LISTENER_KEEPALIVE,
            ...options?.extra,
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
            return;
        }
        client.on('notification', message => {
            if (message.payload && !message.payload.startsWith(PROBE_PREFIX)) {
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
            // Parked queues would not hear anything until the listener is back.
            this.wakeAll();
            this.scheduleReconnect();
        };
        client.on('error', onLost);
        client.on('end', () => onLost());

        try {
            await client.connect();
            await client.query(`LISTEN ${CHANNEL}`);
            if (!(await this.probe(client))) {
                // `this.listener` is not yet set, so ending the client does not trigger
                // `onLost()` and a reconnect.
                void client.end().catch(() => undefined);
                Logger.warn(
                    'Job queue listener did not receive a test notification, so the job queue will poll instead. ' +
                        'This usually means the connection goes through a pooler in transaction mode, ' +
                        'which drops LISTEN. Set `listenerConnection` to the direct database host.',
                    loggerCtx,
                );
                return;
            }
            this.listener = client;
            this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
            Logger.verbose(`Job queue listening on "${CHANNEL}"`, loggerCtx);
        } catch (e: any) {
            void client.end().catch(() => undefined);
            Logger.warn(`Job queue listener could not connect: ${e.message as string}`, loggerCtx);
            this.scheduleReconnect();
        }
    }

    /**
     * Sends a notification through the regular pool and checks that the listener receives
     * it. A pooler in transaction mode accepts `LISTEN` without error but never delivers
     * anything, which would otherwise leave every job waiting for the safety interval.
     */
    private probe(client: Client): Promise<boolean> {
        const payload = PROBE_PREFIX + randomUUID();
        return new Promise(resolve => {
            const finish = (received: boolean) => {
                clearTimeout(timer);
                client.off('notification', onNotification);
                resolve(received);
            };
            const onNotification = (message: Notification) => {
                if (message.payload === payload) {
                    finish(true);
                }
            };
            const timer = setTimeout(() => finish(false), PROBE_TIMEOUT_MS);
            client.on('notification', onNotification);
            this.dataSource?.manager
                .query('SELECT pg_notify($1, $2)', [CHANNEL, payload])
                .catch(() => finish(false));
        });
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
