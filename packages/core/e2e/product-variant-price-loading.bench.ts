/* eslint-disable no-console */
/**
 * OSS-1009: measures what a request reads, and how fast it is, as the number of Channels a
 * ProductVariant is assigned to grows. Before v4.0 `ProductVariant.productVariantPrices` was
 * eager, so every variant arrived with one price row per Channel.
 *
 * Postgres only, because the rows read come from `pg_stat_statements`. Start Postgres with
 * `-c shared_preload_libraries=pg_stat_statements`, then:
 *
 *   DB=postgres bun run bench -- e2e/product-variant-price-loading.bench.ts
 *
 * To compare two builds, run it once per build of `packages/core/dist`. `BENCH_OUT` writes the
 * results as JSON, `BENCH_CHANNELS` sets the channel counts (default `2,50,200`), and
 * `BENCH_DUMP=<file>` appends the three queries which read the most rows for each scenario.
 *
 * Latencies vary a lot between runs on a busy machine. The queries and rows read do not.
 */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import fs from 'fs';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

const CHANNEL_COUNTS = (process.env.BENCH_CHANNELS ?? '2,50,200').split(',').map(Number);
const ROW_SAMPLES = 10;
const LATENCY_SAMPLES = 50;
const THROUGHPUT_CLIENTS = 20;
const THROUGHPUT_MS = 5000;

const PRODUCT_DETAIL = gql`
    query BenchProductDetail {
        product(id: "T_1") {
            id
            variants {
                id
                price
                priceWithTax
                currencyCode
            }
        }
    }
`;
const PRODUCT_LIST = gql`
    query BenchProductList {
        products(options: { take: 10 }) {
            items {
                id
                variants {
                    id
                    price
                    priceWithTax
                }
            }
        }
    }
`;
const ACTIVE_ORDER = gql`
    query BenchActiveOrder {
        activeOrder {
            id
            lines {
                unitPriceWithTax
                productVariant {
                    id
                    price
                }
            }
            totalWithTax
        }
    }
`;
const ADD_ITEM = gql`
    mutation BenchAddItem($id: ID!) {
        addItemToOrder(productVariantId: $id, quantity: 1) {
            ... on Order {
                id
            }
        }
    }
`;
const ADMIN_VARIANTS = gql`
    query BenchAdminVariants {
        productVariants(options: { take: 100 }) {
            items {
                id
                price
                priceWithTax
                prices {
                    price
                    currencyCode
                }
            }
        }
    }
`;
const CREATE_CHANNEL = gql`
    mutation BenchCreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
            }
        }
    }
`;
const ASSIGN_PRODUCTS = gql`
    mutation BenchAssignProducts($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
        }
    }
`;
const PRODUCT_IDS = gql`
    query BenchProductIds {
        products(options: { take: 100 }) {
            items {
                id
            }
        }
    }
`;

interface ScenarioResult {
    channels: number;
    scenario: string;
    queries: number;
    rows: number;
    meanMs: number;
    p50Ms: number;
    p95Ms: number;
    requestsPerSecond?: number;
}

describe.skipIf(process.env.DB !== 'postgres')('ProductVariant price loading benchmark', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(testConfig());
    const results: ScenarioResult[] = [];
    let channelCount = 1;
    let productIds: string[] = [];

    const query = (sql: string) => server.app.get(TransactionalConnection).rawConnection.query(sql);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        await query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
        const { products } = await adminClient.query(PRODUCT_IDS);
        productIds = products.items.map((p: { id: string }) => p.id);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        console.table(results);
        if (process.env.BENCH_OUT) {
            fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify(results, null, 2));
        }
        await server.destroy();
    });

    async function growToChannels(target: number) {
        while (channelCount < target) {
            const code = `bench-${channelCount}`;
            const { createChannel } = await adminClient.query(CREATE_CHANNEL, {
                input: {
                    code,
                    token: code,
                    defaultLanguageCode: LanguageCode.en,
                    defaultCurrencyCode: CurrencyCode.USD,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            await adminClient.query(ASSIGN_PRODUCTS, {
                input: { channelId: createChannel.id, productIds, priceFactor: 1 + channelCount / 100 },
            });
            channelCount++;
        }
    }

    /** Queries and rows read by the database for one call, averaged over several. */
    async function measureRows(run: () => Promise<unknown>) {
        await run();
        await query('SELECT pg_stat_statements_reset()');
        for (let i = 0; i < ROW_SAMPLES; i++) {
            await run();
        }
        const [stats] = await query(
            `SELECT COALESCE(SUM(calls), 0) AS calls, COALESCE(SUM(rows), 0) AS rows
             FROM pg_stat_statements
             WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
               AND query NOT ILIKE '%pg_stat_statements%'`,
        );
        if (process.env.BENCH_DUMP) {
            // The queries which read the most rows, to see where they come from.
            const top = await query(
                `SELECT rows / calls AS rows_per_call, LEFT(REGEXP_REPLACE(query, '\\s+', ' ', 'g'), 400) AS query
                 FROM pg_stat_statements
                 WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
                   AND query NOT ILIKE '%pg_stat_statements%'
                 ORDER BY rows DESC LIMIT 3`,
            );
            fs.appendFileSync(process.env.BENCH_DUMP, JSON.stringify(top) + '\n');
        }
        return {
            queries: Math.round(Number(stats.calls) / ROW_SAMPLES),
            rows: Math.round(Number(stats.rows) / ROW_SAMPLES),
        };
    }

    async function measureLatency(run: () => Promise<unknown>) {
        const times: number[] = [];
        for (let i = 0; i < LATENCY_SAMPLES; i++) {
            const start = performance.now();
            await run();
            times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        const round = (n: number) => Math.round(n * 10) / 10;
        return {
            meanMs: round(times.reduce((a, b) => a + b, 0) / times.length),
            p50Ms: round(times[Math.floor(times.length / 2)]),
            p95Ms: round(times[Math.floor(times.length * 0.95)]),
        };
    }

    /** Requests per second with several clients sending the same anonymous Shop query. */
    async function measureThroughput(document: typeof PRODUCT_DETAIL) {
        const end = Date.now() + THROUGHPUT_MS;
        let count = 0;
        await Promise.all(
            Array.from({ length: THROUGHPUT_CLIENTS }, async () => {
                while (Date.now() < end) {
                    await shopClient.query(document);
                    count++;
                }
            }),
        );
        return Math.round(count / (THROUGHPUT_MS / 1000));
    }

    async function record(scenario: string, run: () => Promise<unknown>, throughput?: typeof PRODUCT_DETAIL) {
        const rows = await measureRows(run);
        const latency = await measureLatency(run);
        const requestsPerSecond = throughput ? await measureThroughput(throughput) : undefined;
        results.push({ channels: channelCount, scenario, ...rows, ...latency, requestsPerSecond });
    }

    for (const target of CHANNEL_COUNTS) {
        it(
            `measures with ${target} channels`,
            async () => {
                await growToChannels(target);
                shopClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await shopClient.asAnonymousUser();

                const detail = await shopClient.query(PRODUCT_DETAIL);
                expect(detail.product.variants.length).toBeGreaterThan(0);
                await record('Shop: product detail', () => shopClient.query(PRODUCT_DETAIL), PRODUCT_DETAIL);
                await record('Shop: product list (10)', () => shopClient.query(PRODUCT_LIST));

                await shopClient.query(ADD_ITEM, { id: 'T_1' });
                await shopClient.query(ADD_ITEM, { id: 'T_2' });
                await record('Shop: activeOrder (2 lines)', () => shopClient.query(ACTIVE_ORDER));
                await record('Shop: addItemToOrder', () => shopClient.query(ADD_ITEM, { id: 'T_3' }));

                await record('Admin: productVariants (100)', () => adminClient.query(ADMIN_VARIANTS));
            },
            30 * 60 * 1000,
        );
    }
});
