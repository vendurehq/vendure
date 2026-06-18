// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../core/typings.d.ts" />
import { bootstrap, JobQueueService, Logger } from '@vendure/core';
import { populate } from '@vendure/core/cli/populate';
import { clearAllTables, populateCustomers, SimpleGraphQLClient } from '@vendure/testing';
import { stringify } from 'csv-stringify';
import fs from 'fs';
import path from 'path';

import { initialData } from '../../core/mock-data/data-sources/initial-data';

import {
    getLoadTestConfig,
    getMysqlConnectionOptions,
    getPostgresConnectionOptions,
    getProductCount,
    getProductCsvFilePath,
} from './load-test-config';

import { awaitRunningJobs } from '../../core/e2e/utils/await-running-jobs';

/* eslint-disable no-console */

/**
 * A script used to populate a database with test data for load testing.
 */
if (require.main === module) {
    // Running from command line
    const count = getProductCount();
    const databaseName = `vendure-load-testing-${count}`;
    isDatabasePopulated(databaseName)
        .then(isPopulated => {
            console.log('isPopulated:', isPopulated);
            if (!isPopulated) {
                const config = getLoadTestConfig('bearer', databaseName);
                const csvFile = getProductCsvFilePath();
                return clearAllTables(config, true)
                    .then(() => {
                        if (!fs.existsSync(csvFile)) {
                            return generateProductsCsv(count);
                        }
                    })
                    .then(() =>
                        populate(
                            () =>
                                bootstrap(config).then(async app => {
                                    await app.get(JobQueueService).start();
                                    return app;
                                }),
                            path.join(__dirname, '../../create/assets/initial-data.json'),
                            csvFile,
                        ),
                    )
                    .then(async app => {
                        console.log('synchronize on search index updated...');
                        const { port, adminApiPath, shopApiPath } = config.apiOptions;
                        const adminClient = new SimpleGraphQLClient(
                            config,
                            `http://localhost:${port}/${adminApiPath!}`,
                        );
                        await adminClient.asSuperAdmin();
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        await awaitRunningJobs(adminClient, 5000000);
                        return app;
                    })
                    .then(async app => {
                        console.log('populating customers...');
                        await populateCustomers(app, 10, message => Logger.error(message));
                        return app.close();
                    });
            } else {
                console.log('Database is already populated!');
            }
        })
        .then(
            () => process.exit(0),
            err => {
                console.log(err);
                process.exit(1);
            },
        );
}

/**
 * Tests to see whether the load test database is already populated.
 */
async function isDatabasePopulated(databaseName: string): Promise<boolean> {
    const isPostgres = process.env.DB === 'postgres';
    if (isPostgres) {
        console.log('Checking whether data is populated (postgres)');
        const pg = require('pg');
        const postgresConnectionOptions = getPostgresConnectionOptions(databaseName);
        const client = new pg.Client({
            host: postgresConnectionOptions.host,
            user: postgresConnectionOptions.username,
            database: postgresConnectionOptions.database,
            password: postgresConnectionOptions.password,
            port: postgresConnectionOptions.port,
        });
        await client.connect();
        try {
            const res = await client.query('SELECT COUNT(id) as prodCount FROM product');
            if (res.rows[0]?.prodcount < 1) {
                return false;
            }
            return true;
        } catch (e: any) {
            if (e.message === 'relation "product" does not exist') {
                return false;
            }
            throw e;
        }
    } else {
        const mysql = require('mysql2/promise');

        const mysqlConnectionOptions = getMysqlConnectionOptions(databaseName);
        const connection = mysql.createConnection({
            host: mysqlConnectionOptions.host,
            user: mysqlConnectionOptions.username,
            password: mysqlConnectionOptions.password,
            database: mysqlConnectionOptions.database,
        });

        return new Promise<boolean>((resolve, reject) => {
            connection.connect((error: any) => {
                if (error) {
                    reject(error);
                    return;
                }

                connection.query('SELECT COUNT(id) as prodCount FROM product', (err: any, results: any) => {
                    if (err) {
                        if (err.code === 'ER_NO_SUCH_TABLE') {
                            resolve(false);
                            return;
                        }
                        reject(err);
                        return;
                    }
                    resolve(true);
                });
            });
        });
    }
}

/**
 * Generates a CSV file of test product data which can then be imported into Vendure.
 */
function generateProductsCsv(productCount: number = 100): Promise<void> {
    const result: any[] = [];

    const stringifier = stringify({
        delimiter: ',',
    });

    const data: string[] = [];

    console.log(`Generating ${productCount} rows of test product data...`);

    stringifier.on('readable', () => {
        let row;
        // eslint-disable-next-line no-cond-assign
        while ((row = stringifier.read())) {
            data.push(row);
        }
    });

    return new Promise((resolve, reject) => {
        const csvFile = getProductCsvFilePath();
        stringifier.on('error', (err: any) => {
            reject(err.message);
        });
        stringifier.on('finish', async () => {
            fs.writeFileSync(csvFile, data.join(''));
            console.log(`Done! Saved to ${csvFile}`);
            resolve();
        });
        generateMockData(productCount, row => stringifier.write(row));
        stringifier.end();
    });
}

function generateMockData(productCount: number, writeFn: (row: string[]) => void) {
    const headers: string[] = [
        'name',
        'slug',
        'description',
        'assets',
        'facets',
        'optionGroups',
        'optionValues',
        'sku',
        'price',
        'taxCategory',
        'variantAssets',
        'variantFacets',
        'stockOnHand',
        'trackInventory',
    ];

    writeFn(headers);

    const categories = getCategoryNames();

    for (let i = 1; i <= productCount; i++) {
        const outputRow = {
            name: `Product ${i}`,
            slug: `product-${i}`,
            description: generateProductDescription(),
            assets: 'product-image.jpg',
            facets: `category:${categories[i % categories.length]}`,
            optionGroups: '',
            optionValues: '',
            sku: `PRODID${i}`,
            price: (Math.random() * 1000).toFixed(2),
            taxCategory: 'standard',
            variantAssets: '',
            variantFacets: '',
            stockOnHand: '1000',
            trackInventory: 'false',
        };
        writeFn(Object.values(outputRow));
    }
}

function getCategoryNames() {
    const allNames = new Set<string>();
    for (const collection of initialData.collections) {
        for (const filter of collection.filters || []) {
            filter.args.facetValueNames.forEach(name => allNames.add(name));
        }
    }
    return Array.from(new Set(allNames));
}

const parts = [
    'Now equipped with seventh-generation Intel Core processors',
    'Laptop is snappier than ever',
    'From daily tasks like launching apps and opening files to more advanced computing',
    'You can power through your day thanks to faster SSDs and Turbo Boost processing up to 3.6GHz',
    'Discover a truly immersive viewing experience with this monitor curved more deeply than any other',
    'Wrapping around your field of vision the 1,800 R screencreates a wider field of view',
    'This pc is optimised for gaming, and is also VR ready',
    'The Intel Core-i7 CPU and High Performance GPU give the computer the raw power it needs to function at a high level',
    'Boost your PC storage with this internal hard drive, designed just for desktop and all-in-one PCs',
    'Let all your colleagues know that you are typing on this exclusive, colorful klicky-klacky keyboard',
    'Solid conductors eliminate strand-interaction distortion and reduce jitter',
    'As the surface is made of high-purity silver',
    'the performance is very close to that of a solid silver cable',
    'but priced much closer to solid copper cable',
    'With its nostalgic design and simple point-and-shoot functionality',
    'the Instant Camera is the perfect pick to get started with instant photography',
    'This lens is a Di type lens using an optical system with improved multi-coating designed to function with digital SLR cameras as well as film cameras',
    'Capture vivid, professional-style photographs with help from this lightweight tripod',
    'The adjustable-height tripod makes it easy to achieve reliable stability',
    'Just the right angle when going after that award-winning shot',
    'Featuring a full carbon chassis - complete with cyclocross-specific carbon fork',
    "It's got the low weight, exceptional efficiency and brilliant handling",
    "You'll need to stay at the front of the pack",
    "When you're working out you need a quality rope that doesn't tangle at every couple of jumps",
    'Training gloves designed for optimum training',
    'Our gloves promote proper punching technique because they are conformed to the natural shape of your fist',
    'Dense, innovative two-layer foam provides better shock absorbency',
    'Full padding on the front, back and wrist to promote proper punching technique',
    'With tons of space inside (for max. 4 persons), full head height throughout',
    'This tent offers you everything you need',
    'Based on the 1970s iconic shape, but made to a larger 69cm size',
    'These skateboards are great for beginners to learn the foot spacing required',
    'Perfect for all-day cruising',
    'This football features high-contrast graphics for high-visibility during play',
    'Its machine-stitched tpu casing offers consistent performance',
    'With its ultra-light, uber-responsive magic foam',
    'The Running Shoe is ready to push you to victories both large and small',
    'A spiky yet elegant house cactus',
    'Perfect for the home or office',
    'Origin and habitat: Probably native only to the Andes of Peru',
    'Gloriously elegant',
    'It can go along with any interior as it is a neutral color and the most popular Phalaenopsis overall',
    '2 to 3 foot stems host large white flowers that can last for over 2 months',
    'Excellent semi-evergreen bonsai',
    'Indoors or out but needs some winter protection',
    'All trees sent will leave the nursery in excellent condition and will be of equal quality or better than the photograph shown',
    'Placing it at home or office can bring you fortune and prosperity',
    'Guards your house and ward off ill fortune',
    'Hand trowel for garden cultivating hammer finish epoxy-coated head',
    'For improved resistance to rust, scratches, humidity and alkalines in the soil',
    'A charming vintage white wooden chair',
    'Featuring an extremely spherical pink balloon',
    'The balloon may be detached and used for other purposes',
    "This premium, tan-brown bonded leather seat is part of the 'chill' sofa range",
    'The lever activated recline feature makes it easy to adjust to any position',
    'This smart, bustle back design with rounded tight padded arms has been designed with your comfort in mind',
    'This well-padded chair has foam pocket sprung seat cushions and fibre-filled back cushions',
    'Modern tapered white polycotton pendant shade with a metallic silver chrome interior',
    'For maximum light reflection',
    'Reversible gimble so it can be used as a ceiling shade or as a lamp shade',
];
function generateProductDescription(): string {
    const take = Math.ceil(Math.random() * 4);
    return shuffle(parts).slice(0, take).join('. ');
}

/**
 * Returns new copy of array in random order.
 * https://stackoverflow.com/a/6274381/772859
 */
function shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}
