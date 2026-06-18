import fs from 'fs';
import path from 'path';
import readline from 'readline';

export type DataPoint = {
    type: 'Point';
    data: {
        time: string;
        value: number;
    };
    metric: string;
};

export type TimeSeriesPoint = { timestamp: number; value: number };

export type LoadTestSummary = {
    timestamp: string;
    script: string;
    productCount: number;
    testDuration: number;
    requests: number;
    throughput: number;
    requestDurationSummary: {
        avg: number;
        min: number;
        max: number;
        med: number;
        p90: number;
        p95: number;
        p99: number;
    };
    requestDurationTimeSeries: TimeSeriesPoint[];
    concurrentUsersTimeSeries: TimeSeriesPoint[];
    requestCountTimeSeries: TimeSeriesPoint[];
};

if (require.main === module) {
    const resultsFile = process.argv[2];
    generateSummary(resultsFile).then(result => {
        // eslint-disable-next-line no-console
        console.log(JSON.stringify(result, null, 2));
        process.exit(0);
    });
}

/**
 * Reads the raw JSON file output from k6 and parses it into a summary object.
 */
export async function generateSummary(rawResultsFile: string): Promise<LoadTestSummary> {
    const lineReader = readline.createInterface({
        input: fs.createReadStream(path.join(__dirname, 'results', rawResultsFile)),
        crlfDelay: Infinity,
    });
    let reqs = 0;
    let min = Infinity;
    let max = 0;
    let sum = 0;
    let startTime = 0;
    let endTime = 0;
    const durations: number[] = [];
    const requestDurationTimeSeries: TimeSeriesPoint[] = [];
    const concurrentUsersTimeSeries: TimeSeriesPoint[] = [];
    const requestCountTimeSeries: TimeSeriesPoint[] = [];

    return new Promise((resolve, reject) => {
        lineReader.on('line', line => {
            const row = JSON.parse(line);
            if (isDataPoint(row)) {
                if (row.metric === 'http_reqs') {
                    reqs++;
                    requestCountTimeSeries.push({ timestamp: +new Date(row.data.time), value: reqs });
                }
                if (row.metric === 'http_req_duration') {
                    const duration = row.data.value;
                    durations.push(duration);
                    requestDurationTimeSeries.push({
                        timestamp: +new Date(row.data.time),
                        value: row.data.value,
                    });
                    if (duration > max) {
                        max = duration;
                    }
                    if (duration < min) {
                        min = duration;
                    }
                    sum += duration;
                }
                if (row.metric === 'vus') {
                    concurrentUsersTimeSeries.push({
                        timestamp: +new Date(row.data.time),
                        value: row.data.value,
                    });
                }
                if (!startTime) {
                    startTime = +new Date(row.data.time);
                }
                endTime = +new Date(row.data.time);
            }
        });

        lineReader.on('close', () => {
            const duration = (endTime - startTime) / 1000;
            durations.sort((a, b) => a - b);

            resolve({
                timestamp: new Date().toISOString(),
                script: rawResultsFile.split('.')[0],
                productCount: +rawResultsFile.split('.')[2],
                testDuration: duration,
                requests: reqs,
                throughput: reqs / duration,
                requestDurationSummary: {
                    avg: sum / reqs,
                    min,
                    max,
                    med: durations[Math.round(durations.length / 2)],
                    p90: percentile(90, durations),
                    p95: percentile(95, durations),
                    p99: percentile(99, durations),
                },
                requestDurationTimeSeries,
                concurrentUsersTimeSeries,
                requestCountTimeSeries,
            });
        });
    });
}

function isDataPoint(row: any): row is DataPoint {
    return row && row.type === 'Point';
}

function percentile(p: number, sortedValues: number[]): number {
    const ordinalRank = (p / 100) * sortedValues.length - 1;
    if (Number.isInteger(ordinalRank)) {
        return sortedValues[ordinalRank];
    }
    // if the rank is not an integer, use linear interpolation between the
    // surrounding values.
    const j = sortedValues[Math.floor(ordinalRank)];
    const k = sortedValues[Math.ceil(ordinalRank)];
    const f = ordinalRank - Math.floor(ordinalRank);
    return j + (k - j) * f;
}
