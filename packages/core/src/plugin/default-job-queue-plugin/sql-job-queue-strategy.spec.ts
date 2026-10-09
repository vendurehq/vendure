import { JobState } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { JobRecord } from './job-record.entity';
import { serverSupportsSkipLocked, SqlJobQueueStrategy } from './sql-job-queue-strategy';

interface RecordedQuery {
    params: Record<string, any>;
    limit?: number;
    lockMode?: string;
    onLocked?: string;
}

/**
 * Creates a SqlJobQueueStrategy on a mock connection, whose query builder records the
 * queries made by `next()` and answers them from `records`. Locking queries for the ids in
 * `takenIds` return nothing, as if another worker had taken those jobs.
 */
function createStrategy(
    type: string,
    version: string,
    records: Array<Partial<JobRecord>>,
    takenIds: number[] = [],
) {
    const queries: RecordedQuery[] = [];
    const createQueryBuilder = () => {
        const query: RecordedQuery = { params: {} };
        const qb: any = {
            where: (_: string, params: object) => (Object.assign(query.params, params), qb),
            andWhere: (_: string, params: object) => (Object.assign(query.params, params), qb),
            orderBy: () => qb,
            limit: (limit: number) => ((query.limit = limit), qb),
            setLock: (lockMode: string) => ((query.lockMode = lockMode), qb),
            setOnLocked: (onLocked: string) => ((query.onLocked = onLocked), qb),
            getOne: () => {
                queries.push(query);
                const { id, queueName, state } = query.params;
                const excludeIds: any[] = query.params.excludeIds ?? [];
                if (query.lockMode && takenIds.includes(id)) {
                    return Promise.resolve(null);
                }
                const matching = records
                    .filter(
                        r =>
                            (id === undefined || r.id === id) &&
                            (queueName === undefined || r.queueName === queueName) &&
                            r.state === state &&
                            !excludeIds.includes(r.id),
                    )
                    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
                return Promise.resolve(matching[0] ?? null);
            },
        };
        return qb;
    };
    const manager = {
        getRepository: () => ({ createQueryBuilder, save: (saved: any) => Promise.resolve(saved) }),
    };
    const rawConnection = {
        isInitialized: true,
        options: { type },
        manager,
        transaction: async (work: (m: any) => Promise<any>) => work(manager),
        query: vi.fn(() => Promise.resolve([{ version }])),
    };
    const strategy = new SqlJobQueueStrategy({ backoffStrategy: () => 1000 });
    strategy.init({ get: () => ({ rawConnection }) } as any);
    return { strategy, queries, rawConnection };
}

function record(id: number, state: JobState, createdAt: string, updatedAgoMs = 60_000): Partial<JobRecord> {
    return {
        id,
        queueName: 'test',
        state,
        data: {},
        attempts: state === JobState.RETRYING ? 1 : 0,
        retries: 3,
        createdAt: new Date(createdAt),
        updatedAt: new Date(Date.now() - updatedAgoMs),
    };
}

describe('SqlJobQueueStrategy', () => {
    describe('next()', () => {
        it('looks up each state with a LIMIT 1 query, then locks the picked job by its id', async () => {
            const { strategy, queries } = createStrategy('postgres', '', [
                record(1, JobState.PENDING, '2020-01-01T00:00:01Z'),
            ]);
            const job = await strategy.next('test');

            expect(job?.id).toBe(1);
            expect(job?.state).toBe(JobState.RUNNING);
            expect(queries).toEqual([
                { params: { queueName: 'test', state: JobState.PENDING }, limit: 1 },
                { params: { queueName: 'test', state: JobState.RETRYING }, limit: 1 },
                {
                    params: { id: 1, state: JobState.PENDING },
                    lockMode: 'pessimistic_write',
                    onLocked: 'skip_locked',
                },
            ]);
        });

        it('picks a RETRYING job when it is older than the oldest PENDING job', async () => {
            const { strategy } = createStrategy('postgres', '', [
                record(1, JobState.PENDING, '2020-01-01T00:00:02Z'),
                record(2, JobState.RETRYING, '2020-01-01T00:00:01Z'),
            ]);
            expect((await strategy.next('test'))?.id).toBe(2);
        });

        it('skips RETRYING jobs which are within their backoff delay', async () => {
            const { strategy, queries } = createStrategy('postgres', '', [
                record(1, JobState.RETRYING, '2020-01-01T00:00:01Z', 0),
                record(2, JobState.RETRYING, '2020-01-01T00:00:02Z'),
                record(3, JobState.PENDING, '2020-01-01T00:00:03Z'),
            ]);
            expect((await strategy.next('test'))?.id).toBe(2);
            expect(queries[2].params).toEqual({
                queueName: 'test',
                state: JobState.RETRYING,
                excludeIds: [1],
            });
        });

        it('stops checking RETRYING jobs once they are newer than the oldest PENDING job', async () => {
            const { strategy, queries } = createStrategy('postgres', '', [
                record(1, JobState.RETRYING, '2020-01-01T00:00:01Z', 0),
                record(2, JobState.PENDING, '2020-01-01T00:00:02Z'),
                record(3, JobState.RETRYING, '2020-01-01T00:00:03Z'),
            ]);
            expect((await strategy.next('test'))?.id).toBe(2);
            // PENDING, RETRYING (job 1, in backoff), RETRYING (job 3, newer), then the lock
            expect(queries.length).toBe(4);
        });

        it('moves on to the next job when another worker took the oldest one', async () => {
            const { strategy } = createStrategy(
                'postgres',
                '',
                [
                    record(1, JobState.PENDING, '2020-01-01T00:00:01Z'),
                    record(2, JobState.PENDING, '2020-01-01T00:00:02Z'),
                ],
                [1],
            );
            expect((await strategy.next('test'))?.id).toBe(2);
        });

        it('returns undefined when there is no job', async () => {
            const { strategy } = createStrategy('postgres', '', [
                record(1, JobState.RUNNING, '2020-01-01T00:00:01Z'),
                record(2, JobState.COMPLETED, '2020-01-01T00:00:02Z'),
            ]);
            expect(await strategy.next('test')).toBeUndefined();
        });

        it.each([
            ['postgres', '', 'skip_locked'],
            ['mariadb', '10.6.12-MariaDB', 'skip_locked'],
            ['mariadb', '10.5.27-MariaDB', undefined],
            ['mysql', '8.0.36', 'skip_locked'],
            ['mysql', '5.7.44', undefined],
            // MariaDB server used via the "mysql" driver
            ['mysql', '10.3.39-MariaDB', undefined],
        ])('on %s %s locks the job with onLocked = %s', async (type, version, expected) => {
            const { strategy, queries } = createStrategy(type, version, [
                record(1, JobState.PENDING, '2020-01-01T00:00:01Z'),
            ]);
            await strategy.next('test');
            const lockQueries = queries.filter(q => q.lockMode);
            expect(lockQueries.length).toBe(1);
            expect(lockQueries[0].lockMode).toBe('pessimistic_write');
            expect(lockQueries[0].onLocked).toBe(expected);
        });

        it('checks the server version only once', async () => {
            const { strategy, rawConnection } = createStrategy('mariadb', '11.4.10-MariaDB', []);
            await strategy.next('test');
            await strategy.next('test');
            expect(rawConnection.query).toHaveBeenCalledTimes(1);
        });

        it('does not lock rows or check the version on SQLite', async () => {
            const { strategy, queries, rawConnection } = createStrategy('sqljs', '', [
                record(1, JobState.PENDING, '2020-01-01T00:00:01Z'),
            ]);
            expect((await strategy.next('test'))?.id).toBe(1);
            expect(queries.length).toBe(2);
            expect(queries.every(q => q.lockMode === undefined)).toBe(true);
            expect(rawConnection.query).not.toHaveBeenCalled();
        });
    });

    describe('serverSupportsSkipLocked()', () => {
        it.each([
            ['8.0.36', true],
            ['8.4.3-standard', true],
            ['9.1.0', true],
            ['8.0.mysql_aurora.3.05.2', true],
            ['5.7.44-log', false],
            ['5.7.mysql_aurora.2.11.2', false],
            ['10.6.12-MariaDB-1:10.6.12+maria~ubu2004', true],
            ['10.11.6-MariaDB', true],
            ['11.4.10-MariaDB-ubu2204', true],
            ['10.5.27-MariaDB', false],
            ['10.3.39-MariaDB-0+deb10u1', false],
            ['', false],
        ])('%s: %s', (version, expected) => {
            expect(serverSupportsSkipLocked(version)).toBe(expected);
        });
    });
});
