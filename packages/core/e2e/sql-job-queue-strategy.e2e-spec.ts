import { JobState } from '@vendure/common/lib/generated-types';
import {
    ConfigService,
    DefaultJobQueuePlugin,
    mergeConfig,
    PollingJobQueueStrategy,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { pollUntil } from './utils/poll-until';

/**
 * Tests for how SqlJobQueueStrategy.next() picks the next job.
 * See https://github.com/vendurehq/vendure/issues/5495
 *
 * The jobs are inserted directly into the job_record table, in queues which have no
 * processor registered, and `next()` is called directly.
 */
describe('SqlJobQueueStrategy next()', () => {
    const activeConfig = testConfig();
    const dbType = activeConfig.dbConnectionOptions.type;
    const isSQLite = dbType === 'sqljs' || dbType === 'better-sqlite3';
    const isMysqlFamily = dbType === 'mysql' || dbType === 'mariadb';

    const { server } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [DefaultJobQueuePlugin.init({ pollInterval: 50, gracefulShutdownTimeout: 1_000 })],
        }),
    );

    let connection: DataSource;
    let strategy: PollingJobQueueStrategy;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-empty.csv'),
            customerCount: 0,
        });
        connection = server.app.get(TransactionalConnection).rawConnection;
        strategy = server.app.get(ConfigService).jobQueueOptions.jobQueueStrategy as PollingJobQueueStrategy;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    const baseTime = new Date('2020-01-01T00:00:00Z').getTime();
    let sequence = 0;

    interface TestJob {
        queueName: string;
        state: JobState;
        tag?: string;
        /** How long ago the job was last updated, which is when a RETRYING job last failed */
        updatedAgoMs?: number;
    }

    /** Inserts jobs with strictly increasing createdAt values, in the order given */
    async function insertJobs(jobs: TestJob[]) {
        const rows = jobs.map(job => {
            sequence++;
            const createdAt = new Date(baseTime + sequence * 1000);
            const isSettled = job.state === JobState.COMPLETED || job.state === JobState.FAILED;
            return {
                queueName: job.queueName,
                data: { tag: job.tag ?? `job-${sequence}` },
                state: job.state,
                progress: 0,
                isSettled,
                settledAt: isSettled ? createdAt : null,
                startedAt: isSettled ? createdAt : null,
                retries: 3,
                attempts: job.state === JobState.RETRYING ? 1 : 0,
                createdAt,
                updatedAt: new Date(Date.now() - (job.updatedAgoMs ?? 60_000)),
            };
        });
        const chunkSize = 250;
        for (let i = 0; i < rows.length; i += chunkSize) {
            await connection.getRepository('JobRecord').insert(rows.slice(i, i + chunkSize));
        }
    }

    async function drain(queueName: string): Promise<string[]> {
        const tags: string[] = [];
        for (let job = await strategy.next(queueName); job; job = await strategy.next(queueName)) {
            tags.push(job.data.tag);
        }
        return tags;
    }

    /** SKIP LOCKED needs PostgreSQL, MySQL 8.0+ or MariaDB 10.6+ */
    async function getServerSupportsSkipLocked(): Promise<boolean> {
        if (dbType === 'postgres') {
            return true;
        }
        const [{ version }] = await connection.query('SELECT VERSION() AS version');
        const [major, minor] = String(version).split('.').map(Number);
        return /mariadb/i.test(version) ? major > 10 || (major === 10 && minor >= 6) : major >= 8;
    }

    it('picks the oldest job across PENDING and RETRYING, skipping RETRYING jobs within their backoff', async () => {
        const queueName = 'test-next-order';
        await insertJobs([
            { queueName, state: JobState.COMPLETED, tag: 'completed' },
            { queueName, state: JobState.RETRYING, tag: 'retrying-1' },
            { queueName, state: JobState.PENDING, tag: 'pending-1' },
            // Failed a moment ago, so it stays within the default 1000ms backoff for this test
            { queueName, state: JobState.RETRYING, tag: 'retrying-in-backoff', updatedAgoMs: -600_000 },
            { queueName, state: JobState.FAILED, tag: 'failed' },
            { queueName: 'other-queue', state: JobState.PENDING, tag: 'other-queue' },
            { queueName, state: JobState.PENDING, tag: 'pending-2' },
            { queueName, state: JobState.RETRYING, tag: 'retrying-2' },
            { queueName, state: JobState.RUNNING, tag: 'running' },
            { queueName, state: JobState.PENDING, tag: 'pending-3' },
        ]);

        expect(await drain(queueName)).toEqual([
            'retrying-1',
            'pending-1',
            'pending-2',
            'retrying-2',
            'pending-3',
        ]);
    });

    it('marks the picked job as RUNNING and returns undefined for an empty queue', async () => {
        const queueName = 'test-next-running';
        await insertJobs([{ queueName, state: JobState.PENDING, tag: 'only' }]);

        const job = await strategy.next(queueName);
        expect(job?.data.tag).toBe('only');
        expect(job?.state).toBe(JobState.RUNNING);
        // next() resolves before its transaction has committed
        await pollUntil(async () => {
            const record = await connection.getRepository('JobRecord').findOneBy({ id: job?.id });
            return record?.state === JobState.RUNNING;
        });

        expect(await strategy.next(queueName)).toBeUndefined();
        expect(await strategy.next('test-next-no-such-queue')).toBeUndefined();
    });

    describe('with a large backlog', () => {
        const queueName = 'test-next-backlog';
        const pendingCount = 2000;
        const settledCount = 6000;

        beforeAll(async () => {
            const queueNames = [queueName, 'test-next-backlog-a', 'test-next-backlog-b'];
            await insertJobs(
                Array.from({ length: settledCount }, (_, i) => ({
                    queueName: queueNames[i % queueNames.length],
                    state: JobState.COMPLETED,
                })),
            );
            await insertJobs(
                Array.from({ length: pendingCount }, (_, i) => ({
                    queueName,
                    state: JobState.PENDING,
                    tag: `backlog-${i}`,
                })),
            );
        }, TEST_SETUP_TIMEOUT_MS);

        it('picks the oldest pending jobs in order', async () => {
            const tags: string[] = [];
            for (let i = 0; i < 5; i++) {
                tags.push((await strategy.next(queueName))?.data.tag);
            }
            expect(tags).toEqual(['backlog-0', 'backlog-1', 'backlog-2', 'backlog-3', 'backlog-4']);
        });

        it('reads a bounded number of rows per pick', async () => {
            if (!isMysqlFamily) {
                // The rows read are counted with MySQL / MariaDB session status counters
                return;
            }
            // A pool with a single connection, so that the session counters see the queries
            // made by next(), and nothing else.
            const singleConnection = new DataSource({
                ...(connection.options as any),
                entities: [connection.getMetadata('JobRecord').target],
                subscribers: [],
                migrations: [],
                synchronize: false,
                extra: { connectionLimit: 1 },
            });
            await singleConnection.initialize();
            try {
                const StrategyClass = strategy.constructor as new () => PollingJobQueueStrategy;
                const singleConnectionStrategy = new StrategyClass();
                singleConnectionStrategy.init({ get: () => ({ rawConnection: singleConnection }) } as any);
                const handlerReads = async () => {
                    const rows: Array<{ Value: string }> = await singleConnection.query(
                        "SHOW SESSION STATUS LIKE 'Handler_read%'",
                    );
                    return rows.reduce((sum, row) => sum + Number(row.Value), 0);
                };
                // The first call also looks up the server version
                await singleConnectionStrategy.next(queueName);

                let maxRowsRead = 0;
                for (let i = 0; i < 10; i++) {
                    const before = await handlerReads();
                    const job = await singleConnectionStrategy.next(queueName);
                    const rowsRead = (await handlerReads()) - before;
                    expect(job).toBeDefined();
                    maxRowsRead = Math.max(maxRowsRead, rowsRead);
                }
                // Reading every pending job of the queue would be at least 2000 rows
                expect(maxRowsRead).toBeLessThan(20);
            } finally {
                await singleConnection.destroy();
            }
        });
    });

    describe('with concurrent workers', () => {
        // SQLite does not lock rows and does not support concurrent transactions
        it('does not wait for a job which is locked by another transaction', async () => {
            if (isSQLite || !(await getServerSupportsSkipLocked())) {
                return;
            }
            const queueName = 'test-next-skip-locked';
            await insertJobs([
                { queueName, state: JobState.PENDING, tag: 'locked' },
                { queueName, state: JobState.PENDING, tag: 'free' },
            ]);
            const locked = await connection.getRepository('JobRecord').findOneOrFail({
                where: { queueName, state: JobState.PENDING },
                order: { createdAt: 'ASC' },
            });

            const queryRunner = connection.createQueryRunner();
            await queryRunner.startTransaction();
            try {
                await queryRunner.manager
                    .getRepository('JobRecord')
                    .createQueryBuilder('record')
                    .setLock('pessimistic_write')
                    .where('record.id = :id', { id: locked.id })
                    .getOne();

                const job = await strategy.next(queueName);
                expect(job?.data.tag).toBe('free');
            } finally {
                await queryRunner.rollbackTransaction();
                await queryRunner.release();
            }
        });

        it('never gives the same job to two workers', async () => {
            if (isSQLite) {
                return;
            }
            const queueName = 'test-next-concurrent';
            const jobCount = 60;
            const workerCount = 5;
            await insertJobs(
                Array.from({ length: jobCount }, (_, i) => ({
                    queueName,
                    state: i % 4 === 0 ? JobState.RETRYING : JobState.PENDING,
                })),
            );

            const ids: string[] = [];
            for (let i = 0; i < jobCount && ids.length < jobCount; i++) {
                const jobs = await Promise.all(
                    Array.from({ length: workerCount }, () => strategy.next(queueName)),
                );
                ids.push(...jobs.filter(job => !!job).map(job => String(job?.id)));
            }
            expect(ids.length).toBe(jobCount);
            expect(new Set(ids).size).toBe(jobCount);
        });
    });
});
