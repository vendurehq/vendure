import { JobListOptions, JobState } from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import { DataSource, EntityManager, FindOptionsWhere, In, LessThan } from 'typeorm';

import { Injector } from '../../common/injector';
import { InspectableJobQueueStrategy, JobQueueStrategy } from '../../config';
import { Logger } from '../../config/logger/vendure-logger';
import { getDatabaseType } from '../../connection/database-type';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Job, JobData, JobQueueStrategyJobOptions } from '../../job-queue';
import { PollingJobQueueStrategy } from '../../job-queue/polling-job-queue-strategy';
import { ListQueryBuilder } from '../../service/helpers/list-query-builder/list-query-builder';

import { JobRecord } from './job-record.entity';

/**
 * @description
 * A {@link JobQueueStrategy} which uses the configured SQL database to persist jobs in the queue.
 * This strategy is used by the {@link DefaultJobQueuePlugin}.
 *
 * @docsCategory JobQueue
 */
export class SqlJobQueueStrategy extends PollingJobQueueStrategy implements InspectableJobQueueStrategy {
    private rawConnection: DataSource | undefined;
    private connection: TransactionalConnection | undefined;
    private listQueryBuilder: ListQueryBuilder;
    private skipLockedSupported: boolean | undefined;

    init(injector: Injector) {
        this.rawConnection = injector.get(TransactionalConnection).rawConnection;
        this.connection = injector.get(TransactionalConnection);
        this.listQueryBuilder = injector.get(ListQueryBuilder);
        this.skipLockedSupported = undefined;
        super.init(injector);
    }

    destroy() {
        this.rawConnection = undefined;
        super.destroy();
    }

    async add<Data extends JobData<Data> = object>(
        job: Job<Data>,
        jobOptions?: JobQueueStrategyJobOptions<Data>,
    ): Promise<Job<Data>> {
        if (!this.connectionAvailable(this.rawConnection)) {
            throw new Error('Connection not available');
        }
        const jobRecordRepository =
            jobOptions?.ctx && this.connection
                ? this.connection.getRepository(jobOptions.ctx, JobRecord)
                : this.rawConnection.getRepository(JobRecord);
        const constrainedData = this.constrainDataSize(job);
        const newRecord = this.toRecord(job, constrainedData, this.setRetries(job.queueName, job));
        const record = await jobRecordRepository.save(newRecord);
        return this.fromRecord(record);
    }

    /**
     * MySQL & MariaDB store job data as a "text" type which has a limit of 64kb. Going over that limit will cause the job to not be stored.
     * In order to try to prevent that, this method will truncate any strings in the `data` object over 2kb in size.
     */
    private constrainDataSize<Data extends JobData<Data> = object>(job: Job<Data>): Data | undefined {
        const type = this.rawConnection && getDatabaseType(this.rawConnection);
        if (type === 'mysql' || type === 'mariadb') {
            const stringified = JSON.stringify(job.data);
            if (64 * 1024 <= stringified.length) {
                const truncatedKeys: Array<{ key: string; size: number }> = [];
                const reduced = JSON.parse(stringified, (key, value) => {
                    if (typeof value === 'string' && 2048 < value.length) {
                        truncatedKeys.push({ key, size: value.length });
                        return `[truncated - originally ${value.length} bytes]`;
                    }
                    return value;
                });
                Logger.warn(
                    `Job data for "${
                        job.queueName
                    }" is too long to store with the ${type} driver (${Math.round(
                        stringified.length / 1024,
                    )}kb).\nThe following keys were truncated: ${truncatedKeys
                        .map(({ key, size }) => `${key} (${size} bytes)`)
                        .join(', ')}`,
                );
                return reduced;
            }
        }
    }

    async next(queueName: string): Promise<Job | undefined> {
        if (!this.connectionAvailable(this.rawConnection)) {
            throw new Error('Connection not available');
        }
        const connection = this.rawConnection;
        const connectionType = getDatabaseType(this.rawConnection);
        const isSQLite =
            connectionType === 'sqlite' || connectionType === 'sqljs' || connectionType === 'better-sqlite3';

        const skipLocked = !isSQLite && (await this.supportsSkipLocked(connection));

        return new Promise(async (resolve, reject) => {
            if (isSQLite) {
                try {
                    // SQLite driver does not support concurrent transactions. See https://github.com/typeorm/typeorm/issues/1884
                    const result = await this.getNextAndSetAsRunning(
                        connection.manager,
                        queueName,
                        false,
                        false,
                    );
                    resolve(result);
                } catch (e: any) {
                    reject(e);
                }
            } else {
                // Selecting the next job is wrapped in a transaction so that we can
                // set a lock on that row and immediately update the status to "RUNNING".
                // This prevents multiple worker processes from taking the same job when
                // running concurrent workers.
                connection
                    .transaction(async transactionManager => {
                        const result = await this.getNextAndSetAsRunning(
                            transactionManager,
                            queueName,
                            true,
                            skipLocked,
                        );
                        resolve(result);
                    })
                    .catch(err => reject(err));
            }
        });
    }

    /**
     * Picks the oldest PENDING or RETRYING job of the queue (skipping RETRYING jobs which are still
     * within their backoff delay) and marks it as RUNNING.
     *
     * See https://github.com/vendurehq/vendure/issues/5495: each state is looked up with its own
     * `LIMIT 1` query, so that the database can seek to a single row via the
     * (queueName, state, createdAt) index. Those lookups take no locks. Only the chosen job is
     * then locked, by its primary key. A locking range query would also lock the gaps around the
     * range under REPEATABLE READ (the MySQL/MariaDB default), which blocks inserts and makes
     * concurrent workers deadlock when they set their jobs to RUNNING.
     */
    private async getNextAndSetAsRunning(
        manager: EntityManager,
        queueName: string,
        setLock: boolean,
        skipLocked: boolean,
    ): Promise<Job | undefined> {
        // Jobs which are within their backoff delay, or which another worker took first
        const skippedJobIds: ID[] = [];
        for (;;) {
            const candidate = await this.findNextRecord(manager, queueName, skippedJobIds);
            if (!candidate) {
                return;
            }
            const record = setLock
                ? await this.lockRecord(manager, queueName, candidate, skipLocked)
                : candidate;
            if (!record) {
                skippedJobIds.push(candidate.id);
                continue;
            }
            const job = this.fromRecord(record);
            job.start();
            record.state = JobState.RUNNING;
            await manager.getRepository(JobRecord).save(record, { reload: false });
            return job;
        }
    }

    /**
     * Returns the oldest PENDING job, or an older RETRYING job which is not within its backoff
     * delay. The ids of RETRYING jobs within their backoff delay are added to `skippedJobIds`.
     */
    private async findNextRecord(
        manager: EntityManager,
        queueName: string,
        skippedJobIds: ID[],
    ): Promise<JobRecord | undefined> {
        const pending = await this.findOldestRecord(manager, queueName, JobState.PENDING, skippedJobIds);
        for (;;) {
            const retrying = await this.findOldestRecord(
                manager,
                queueName,
                JobState.RETRYING,
                skippedJobIds,
            );
            if (!retrying || (pending && +pending.createdAt <= +retrying.createdAt)) {
                return pending ?? undefined;
            }
            if (!this.isWithinBackoff(queueName, retrying)) {
                return retrying;
            }
            skippedJobIds.push(retrying.id);
        }
    }

    private findOldestRecord(
        manager: EntityManager,
        queueName: string,
        state: JobState,
        excludeIds: ID[],
    ): Promise<JobRecord | null> {
        const qb = manager
            .getRepository(JobRecord)
            .createQueryBuilder('record')
            .where('record.queueName = :queueName', { queueName })
            .andWhere('record.state = :state', { state })
            .orderBy('record.createdAt', 'ASC')
            .limit(1);
        if (excludeIds.length) {
            qb.andWhere('record.id NOT IN (:...excludeIds)', { excludeIds });
        }
        return qb.getOne();
    }

    /**
     * Locks the row of the given job, unless another worker has taken the job in the meantime.
     */
    private async lockRecord(
        manager: EntityManager,
        queueName: string,
        candidate: JobRecord,
        skipLocked: boolean,
    ): Promise<JobRecord | undefined> {
        const qb = manager
            .getRepository(JobRecord)
            .createQueryBuilder('record')
            .where('record.id = :id', { id: candidate.id })
            .andWhere('record.state = :state', { state: candidate.state })
            .setLock('pessimistic_write');
        if (skipLocked) {
            // A job which is locked is being taken by another worker, so there is no point in
            // waiting for it.
            qb.setOnLocked('skip_locked');
        }
        const record = await qb.getOne();
        if (!record || (record.state === JobState.RETRYING && this.isWithinBackoff(queueName, record))) {
            return;
        }
        return record;
    }

    private isWithinBackoff(queueName: string, record: JobRecord): boolean {
        if (typeof this.backOffStrategy !== 'function') {
            return false;
        }
        const msSinceLastFailure = Date.now() - +record.updatedAt;
        const backOffDelayMs = this.backOffStrategy(queueName, record.attempts, this.fromRecord(record));
        return msSinceLastFailure < backOffDelayMs;
    }

    /**
     * `FOR UPDATE SKIP LOCKED` is supported by PostgreSQL, MySQL 8.0+ and MariaDB 10.6+. On older
     * MySQL and MariaDB versions it is a syntax error, so the server version is checked once.
     */
    private async supportsSkipLocked(connection: DataSource): Promise<boolean> {
        if (this.skipLockedSupported === undefined) {
            this.skipLockedSupported = await this.detectSkipLockedSupport(connection);
        }
        return this.skipLockedSupported;
    }

    private async detectSkipLockedSupport(connection: DataSource): Promise<boolean> {
        const type = getDatabaseType(connection);
        if (type === 'postgres') {
            return true;
        }
        if (type !== 'mysql' && type !== 'mariadb') {
            return false;
        }
        // The raw version string is used rather than the TypeORM driver's `version`, because
        // the driver strips the "-MariaDB" suffix, and a MariaDB server can also be used via
        // the "mysql" driver.
        const result: Array<{ version: string }> = await connection.query('SELECT VERSION() AS version');
        return serverSupportsSkipLocked(String(result[0]?.version ?? ''));
    }

    async update(job: Job<any>): Promise<void> {
        if (!this.connectionAvailable(this.rawConnection)) {
            throw new Error('Connection not available');
        }
        await this.rawConnection
            .getRepository(JobRecord)
            .createQueryBuilder('job')
            .update()
            .set(this.toRecord(job))
            .where('id = :id', { id: job.id })
            .andWhere('settledAt IS NULL')
            .execute();
    }

    async findMany(options?: JobListOptions): Promise<PaginatedList<Job>> {
        if (!this.connectionAvailable(this.rawConnection)) {
            throw new Error('Connection not available');
        }
        return this.listQueryBuilder
            .build(JobRecord, options)
            .getManyAndCount()
            .then(([items, totalItems]) => ({
                items: items.map(this.fromRecord),
                totalItems,
            }));
    }

    async findOne(id: ID): Promise<Job | undefined> {
        if (!this.connectionAvailable(this.rawConnection)) {
            throw new Error('Connection not available');
        }
        const record = await this.rawConnection.getRepository(JobRecord).findOne({ where: { id } });
        if (record) {
            return this.fromRecord(record);
        }
    }

    async findManyById(ids: ID[]): Promise<Job[]> {
        if (!this.connectionAvailable(this.rawConnection)) {
            throw new Error('Connection not available');
        }
        return this.rawConnection
            .getRepository(JobRecord)
            .find({ where: { id: In(ids) } })
            .then(records => records.map(this.fromRecord));
    }

    async removeSettledJobs(queueNames: string[] = [], olderThan?: Date) {
        if (!this.connectionAvailable(this.rawConnection)) {
            throw new Error('Connection not available');
        }
        const findOptions: FindOptionsWhere<JobRecord> = {
            ...(0 < queueNames.length ? { queueName: In(queueNames) } : {}),
            isSettled: true,
            settledAt: LessThan(olderThan || new Date()),
        };
        const toDelete = await this.rawConnection.getRepository(JobRecord).find({ where: findOptions });
        const deleteCount = await this.rawConnection.getRepository(JobRecord).count({ where: findOptions });
        await this.rawConnection.getRepository(JobRecord).delete(findOptions);
        return deleteCount;
    }

    private connectionAvailable(connection: DataSource | undefined): connection is DataSource {
        return !!this.rawConnection && this.rawConnection.isInitialized;
    }

    private toRecord(job: Job<any>, data?: any, retries?: number): JobRecord {
        return new JobRecord({
            id: job.id || undefined,
            queueName: job.queueName,
            data: data ?? job.data,
            state: job.state,
            progress: job.progress,
            result: job.result,
            error: job.error,
            startedAt: job.startedAt,
            settledAt: job.settledAt,
            isSettled: job.isSettled,
            retries: retries ?? job.retries,
            attempts: job.attempts,
        });
    }

    private fromRecord(this: void, jobRecord: JobRecord): Job<any> {
        return new Job<any>(jobRecord);
    }
}

/**
 * Whether a MySQL or MariaDB server with the given `SELECT VERSION()` string supports
 * `SELECT ... FOR UPDATE SKIP LOCKED` (MySQL 8.0+, MariaDB 10.6+).
 */
export function serverSupportsSkipLocked(versionString: string): boolean {
    const match = versionString.match(/^(\d+)\.(\d+)/);
    if (!match) {
        return false;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (/mariadb/i.test(versionString)) {
        return major > 10 || (major === 10 && minor >= 6);
    }
    return major >= 8;
}
