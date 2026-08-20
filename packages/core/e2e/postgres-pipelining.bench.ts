/* eslint-disable no-console */
import { Bench } from 'tinybench';
import { DataSource, QueryRunner } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getDbConfig } from '../../../e2e-common/test-config';

const BATCH_SIZE = 10;
const expectedValues = Array.from({ length: BATCH_SIZE }, (_, index) => index);

describe.skipIf(process.env.DB !== 'postgres')('PostgreSQL query pipelining benchmark', () => {
    let sequentialDataSource: DataSource;
    let pipelinedDataSource: DataSource;
    let sequentialQueryRunner: QueryRunner;
    let pipelinedQueryRunner: QueryRunner;

    beforeAll(async () => {
        const connectionOptions = getDbConfig();
        if (connectionOptions.type !== 'postgres') {
            throw new Error('This benchmark requires DB=postgres');
        }

        sequentialDataSource = await createDataSource(connectionOptions, false);
        pipelinedDataSource = await createDataSource(connectionOptions, true);
        sequentialQueryRunner = sequentialDataSource.createQueryRunner();
        pipelinedQueryRunner = pipelinedDataSource.createQueryRunner();
        await Promise.all([sequentialQueryRunner.connect(), pipelinedQueryRunner.connect()]);
    });

    afterAll(async () => {
        await Promise.all([sequentialQueryRunner?.release(), pipelinedQueryRunner?.release()]);
        await Promise.all([sequentialDataSource?.destroy(), pipelinedDataSource?.destroy()]);
    });

    it('compares batches of concurrent queries on one TypeORM QueryRunner', async () => {
        const sequentialResult = await runBatch(sequentialQueryRunner);
        const pipelinedResult = await runBatch(pipelinedQueryRunner);
        expect(getValues(sequentialResult)).toEqual(expectedValues);
        expect(getValues(pipelinedResult)).toEqual(expectedValues);

        const bench = new Bench({
            warmupTime: 500,
            time: 2000,
        });
        bench
            .add('pipeline off', () => runBatch(sequentialQueryRunner))
            .add('pipeline on', () => runBatch(pipelinedQueryRunner));

        const tasks = await bench.run();
        const sequentialQps = getQueriesPerSecond(tasks[0].result?.hz);
        const pipelinedQps = getQueriesPerSecond(tasks[1].result?.hz);
        const speedup = pipelinedQps / sequentialQps;

        console.table([
            { mode: 'pipeline off', queriesPerSecond: Math.round(sequentialQps) },
            { mode: 'pipeline on', queriesPerSecond: Math.round(pipelinedQps) },
            { mode: 'ratio', queriesPerSecond: `${speedup.toFixed(2)}x` },
        ]);

        expect(sequentialQps).toBeGreaterThan(0);
        expect(pipelinedQps).toBeGreaterThan(0);
    });
});

async function createDataSource(
    connectionOptions: PostgresConnectionOptions,
    pipeline: boolean,
): Promise<DataSource> {
    const dataSource = new DataSource({
        ...connectionOptions,
        database: 'postgres',
        entities: [],
        synchronize: false,
        extra: {
            ...connectionOptions.extra,
            pipeline,
        },
    });
    await dataSource.initialize();
    return dataSource;
}

function runBatch(queryRunner: QueryRunner): Promise<any[]> {
    return Promise.all(
        expectedValues.map(value => queryRunner.query('SELECT $1::integer AS value', [value])),
    );
}

function getValues(results: any[]): number[] {
    return results.map(rows => rows[0].value);
}

function getQueriesPerSecond(iterationsPerSecond: number | undefined): number {
    if (!iterationsPerSecond) {
        throw new Error('Benchmark did not produce a throughput result');
    }
    return iterationsPerSecond * BATCH_SIZE;
}
