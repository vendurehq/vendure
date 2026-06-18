/* eslint-disable no-console */
import { INestApplication } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    bootstrap,
    Importer,
    isGraphQlErrorResult,
    LanguageCode,
    OrderService,
    RequestContextService,
} from '@vendure/core';
import { populate } from '@vendure/core/cli/populate';
import { ParsedProductWithVariants } from '@vendure/core/src/index';
import { clearAllTables } from '@vendure/testing';
import { spawn } from 'child_process';
import program from 'commander';
import path from 'path';
import ProgressBar from 'progress';

import { getLoadTestConfig } from './load-test-config';

/**
 * This set of benchmarks aims to specifically test the performance issues discussed
 * in issue https://github.com/vendurehq/vendure/issues/1506.
 *
 * In order to test these issues, we need a test dataset that will create:
 *
 * 1. 1k Products, each with 10 ProductVariants
 * 2. 10k Orders, each with 10 OrderLines, each OrderLine with qty 5
 *
 * Then we will test:
 *
 * 1. Fetching 10 Products from the `products` query. This will test the effects of indexes, ListQueryBuilder & dataloader
 * 2. As above but with Orders
 * 3. Fetching a list of orders and selecting only the Order id.
 *    This will test optimization of selecting & joining only the needed fields.
 */

const DATABASE_NAME = 'vendure-benchmarks';
const PRODUCT_COUNT = 1000;
const VARIANTS_PER_PRODUCT = 10;
const ORDER_COUNT = 10000;
const LINES_PER_ORDER = 10;
const QUANTITY_PER_ORDER_LINE = 5;

interface Options {
    script?: string;
    db: 'mysql' | 'postgres';
    populate?: boolean;
    variant?: string;
}

program
    .option('--script <script>', 'Specify the k6 script to run')
    .option('--db <db>', 'Select which database to test against', /^(mysql|postgres)$/, 'mysql')
    .option('--populate', 'Whether to populate the database')
    .option('--variant <variant>', 'Which variant of the given script')
    .parse(process.argv);

const opts = program.opts() as any;

runBenchmark(opts).then(() => process.exit(0));

async function runBenchmark(options: Options) {
    const config = getLoadTestConfig('bearer', DATABASE_NAME, options.db);
    if (options.populate) {
        console.log(`Populating benchmark database "${DATABASE_NAME}"`);
        await clearAllTables(config, true);
        const populateApp = await populate(
            () => bootstrap(config),
            path.join(__dirname, '../../create/assets/initial-data.json'),
        );
        await createProducts(populateApp);
        await createOrders(populateApp);
        await populateApp.close();
    } else {
        const app = await bootstrap(config);
        await new Promise((resolve, reject) => {
            const runArgs: string[] = ['run', `./scripts/${options.script}`];
            if (options.variant) {
                console.log(`Using variant "${options.variant}"`);
                runArgs.push('-e', `variant=${options.variant}`);
            }
            const loadTest = spawn('k6', runArgs, {
                cwd: __dirname,
                stdio: 'inherit',
            });
            loadTest.on('exit', code => {
                if (code === 0) {
                    resolve(code);
                } else {
                    reject();
                }
            });
            loadTest.on('error', err => {
                reject(err);
            });
        });
        await app.close();
    }
}

async function createProducts(app: INestApplication) {
    const importer = app.get(Importer);
    const ctx = await app.get(RequestContextService).create({
        apiType: 'admin',
    });

    const bar = new ProgressBar('creating products [:bar] (:current/:total) :percent :etas', {
        complete: '=',
        incomplete: ' ',
        total: PRODUCT_COUNT,
        width: 40,
    });

    const products: ParsedProductWithVariants[] = [];
    for (let i = 0; i < PRODUCT_COUNT; i++) {
        const product: ParsedProductWithVariants = {
            product: {
                optionGroups: [
                    {
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: `prod-${i}-option`,
                                values: Array.from({ length: VARIANTS_PER_PRODUCT }).map(
                                    (_, opt) => `prod-${i}-option-${opt}`,
                                ),
                            },
                        ],
                    },
                ],
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        name: `Product ${i}`,
                        slug: `product-${i}`,
                        description: '',
                        customFields: {},
                    },
                ],
                assetPaths: [],
                facets: [],
            },
            variants: Array.from({ length: VARIANTS_PER_PRODUCT }).map((value, index) => ({
                sku: `PROD-${i}-${index}`,
                facets: [],
                assetPaths: [],
                price: 1000,
                stockOnHand: 100,
                taxCategory: 'standard',
                trackInventory: GlobalFlag.INHERIT,
                translations: [
                    {
                        languageCode: LanguageCode.en,
                        optionValues: [`prod-${i}-option-${index}`],
                        customFields: {},
                    },
                ],
            })),
        };
        products.push(product);
    }
    await importer.importProducts(ctx, products, progess => bar.tick());
}

async function createOrders(app: INestApplication) {
    const orderService = app.get(OrderService);
    const bar = new ProgressBar('creating orders [:bar] (:current/:total) :percent :etas', {
        complete: '=',
        incomplete: ' ',
        total: ORDER_COUNT,
        width: 40,
    });

    for (let i = 0; i < ORDER_COUNT; i++) {
        const ctx = await app.get(RequestContextService).create({
            apiType: 'shop',
        });
        const order = await orderService.create(ctx);
        const variantId = (i % (PRODUCT_COUNT * VARIANTS_PER_PRODUCT)) + 1;
        const result = await orderService.addItemToOrder(ctx, order.id, variantId, QUANTITY_PER_ORDER_LINE);
        if (isGraphQlErrorResult(result)) {
            console.log(result);
        }
        bar.tick();
    }
}
