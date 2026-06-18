/* eslint-disable no-console */
import { INestApplication } from '@nestjs/common';
import { bootstrap, JobQueueService } from '@vendure/core';
import { spawn } from 'child_process';
import { stringify } from 'csv-stringify';
import fs from 'fs';
import path from 'path';

import { omit } from '../../common/src/omit';

import { generateSummary, LoadTestSummary } from './generate-summary';
import { getLoadTestConfig, getProductCount, getScriptToRun } from './load-test-config';

const count = getProductCount();

if (require.main === module) {
    const ALL_SCRIPTS = ['deep-query.js', 'search-and-checkout.js', 'very-large-order.js'];

    const scriptsToRun = getScriptToRun() || ALL_SCRIPTS;

    console.log(`\n============= Vendure Load Test: ${count} products ============\n`);

    // Runs the init script to generate test data and populate the test database
    const init = spawn('node', ['-r', 'ts-node/register', './init-load-test.ts', count.toString()], {
        cwd: __dirname,
        stdio: 'inherit',
    });

    init.on('exit', async code => {
        if (code === 0) {
            const databaseName = `vendure-load-testing-${count}`;
            return bootstrap(getLoadTestConfig('cookie', databaseName))
                .then(async app => {
                    // await app.get(JobQueueService).start();
                    const summaries: LoadTestSummary[] = [];
                    for (const script of scriptsToRun) {
                        const summary = await runLoadTestScript(script);
                        summaries.push(summary);
                    }
                    return closeAndExit(app, summaries);
                })
                .catch(err => {
                    // eslint-disable-next-line
                    console.log(err);
                });
        } else {
            process.exit(code || 1);
        }
    });
}

async function runLoadTestScript(script: string): Promise<LoadTestSummary> {
    const rawResultsFile = `${script}.${count}.json`;

    return new Promise((resolve, reject) => {
        const loadTest = spawn(
            'k6',
            ['run', `./scripts/${script}`, '--out', `json=results/${rawResultsFile}`],
            {
                cwd: __dirname,
                stdio: 'inherit',
            },
        );
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
    }).then(() => generateSummary(rawResultsFile));
}

async function closeAndExit(app: INestApplication, summaries: LoadTestSummary[]) {
    console.log('Closing server and preparing results...');
    // allow a pause for all queries to complete before closing the app
    await new Promise(resolve => setTimeout(resolve, 3000));
    await app.close();
    const dateString = getDateString();

    // write summary JSON
    const summaryData = summaries.map(s =>
        omit(s, ['requestDurationTimeSeries', 'concurrentUsersTimeSeries', 'requestCountTimeSeries']),
    );
    const summaryFile = path.join(__dirname, `results/load-test-${dateString}-${count}.json`);
    fs.writeFileSync(summaryFile, JSON.stringify(summaryData, null, 2), 'utf-8');
    console.log(`Summary written to ${path.relative(__dirname, summaryFile)}`);

    // write time series CSV
    for (const summary of summaries) {
        const csvData = await getTimeSeriesCsvData(summary);
        const timeSeriesFile = path.join(
            __dirname,
            `results/load-test-${dateString}-${count}-${summary.script}.csv`,
        );
        fs.writeFileSync(timeSeriesFile, csvData, 'utf-8');
        console.log(`Time series data written to ${path.relative(__dirname, timeSeriesFile)}`);
    }

    process.exit(0);
}

async function getTimeSeriesCsvData(summary: LoadTestSummary): Promise<string> {
    const stringifier = stringify({
        delimiter: ',',
    });

    const data: string[] = [];

    stringifier.on('readable', () => {
        let row;
        // eslint-disable-next-line no-cond-assign
        while ((row = stringifier.read())) {
            data.push(row);
        }
    });

    stringifier.write([
        `${summary.script}:elapsed`,
        `${summary.script}:request_duration`,
        `${summary.script}:user_count`,
        `${summary.script}:reqs`,
    ]);

    let startTime: number | undefined;

    for (const row of summary.requestDurationTimeSeries) {
        if (!startTime) {
            startTime = row.timestamp;
        }
        stringifier.write([row.timestamp - startTime, row.value, '', '']);
    }
    for (const row of summary.concurrentUsersTimeSeries) {
        if (!startTime) {
            startTime = row.timestamp;
        }
        stringifier.write([row.timestamp - startTime, '', row.value, '']);
    }
    for (const row of summary.requestCountTimeSeries) {
        if (!startTime) {
            startTime = row.timestamp;
        }
        stringifier.write([row.timestamp - startTime, '', '', row.value]);
    }

    stringifier.end();

    return new Promise((resolve, reject) => {
        stringifier.on('error', (err: any) => {
            reject(err.message);
        });
        stringifier.on('finish', async () => {
            resolve(data.join(''));
        });
    });
}

function getDateString(): string {
    return new Date().toISOString().split('.')[0].replace(/[:\.]/g, '_');
}
