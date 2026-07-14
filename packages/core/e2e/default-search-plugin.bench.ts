/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { DefaultJobQueuePlugin, DefaultSearchPlugin, mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import path from 'path';
import { Bench } from 'tinybench';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    SearchProductsShopQuery,
    SearchProductsShopQueryVariables,
} from './graphql/generated-e2e-shop-types';
import { searchProductsShopDocument } from './graphql/shop-definitions';
import { awaitRunningJobs } from './utils/await-running-jobs';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__'), 1000));

interface SearchProductsShopQueryVariablesExt extends SearchProductsShopQueryVariables {
    input: SearchProductsShopQueryVariables['input'] & {
        // This input field is dynamically added only when the `indexStockStatus` init option
        // is set to `true`, and therefore not included in the generated type. Therefore
        // we need to manually patch it here.
        inStock?: boolean;
    };
}

const { server, adminClient, shopClient } = createTestEnvironment(
    mergeConfig(testConfig(), {
        plugins: [DefaultSearchPlugin.init({ indexStockStatus: true }), DefaultJobQueuePlugin],
    }),
);

let marginFactor = 1; // Defaults to 1, will be adjusted during test
let cpuFactor = 1; // Defaults to 1, will be adjusted during test
const fibonacci = (i: number): number => {
    if (i <= 1) return i;
    return fibonacci(i - 1) + fibonacci(i - 2);
};

beforeAll(async () => {
    await server.init({
        initialData,
        productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-default-search.csv'),
        customerCount: 1,
    });
    await adminClient.asSuperAdmin();
    await awaitRunningJobs(adminClient);
}, TEST_SETUP_TIMEOUT_MS);

afterAll(async () => {
    await server.destroy();
});

const isDevelopment = process.env.NODE_ENV === 'development';
describe.skipIf(isDevelopment)('Default search plugin - benchmark', () => {
    it('defines benchmark cpu and margin factor', async () => {
        const bench = new Bench({
            warmupTime: 0,
            warmupIterations: 1,
            time: 0,
            iterations: 10,
        });

        bench.add('measure time to calcualate fibonacci', () => {
            fibonacci(41); // If this task would take 1000 ms the cpuFactor would be 1.
        });

        const tasks = await bench.run();

        // console.table(bench.table());

        tasks.forEach(task => {
            expect(task.result?.rme).toBeDefined();
            expect(task.result?.mean).toBeDefined();
            if (task.result?.rme && task.result?.mean) {
                marginFactor = 1 + task.result.rme / 100;
                cpuFactor = 1000 / task.result.mean;
            }
        });
    });

    it('performs when grouped by product', async () => {
        const bench = new Bench({
            warmupTime: 0,
            warmupIterations: 3,
            time: 0,
            iterations: 1000,
        });

        bench.add('group by product', async () => {
            await shopClient.query<SearchProductsShopQuery, SearchProductsShopQueryVariablesExt>(
                searchProductsShopDocument,
                {
                    input: {
                        groupByProduct: true,
                    },
                },
            );
        });

        const tasks = await bench.run();

        // console.table(bench.table());

        tasks.forEach(task => {
            expect(task.result?.mean).toBeDefined();
            if (task.result?.mean) {
                expect(task.result.mean * cpuFactor).toBeLessThan(6.835 * marginFactor);
            }
        });
    });
});
