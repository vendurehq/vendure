import { LogLine } from '@vendure/common/lib/log';
import { DefaultJobQueuePlugin, DefaultLogger, LogLevel, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    ProcessedRequestIdJob,
    REQUEST_ID_TEST_LOGGER_CTX,
    RequestIdTestPlugin,
} from './fixtures/test-plugins/request-id-test-plugin';

const getJobDataDocument = gql`
    query GetJobData($id: ID!) {
        job(jobId: $id) {
            data
        }
    }
`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Every request gets an ID, which is on its RequestContext, on the JSON log lines written while
 * it is handled, and on the jobs it adds. The job runs through the SQL job queue, so the ID is
 * also read back from the database.
 */
describe('Request IDs', () => {
    const activeConfig = testConfig();
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            logger: new DefaultLogger({ format: 'json', level: LogLevel.Verbose }),
            plugins: [
                DefaultJobQueuePlugin.init({ pollInterval: 50, gracefulShutdownTimeout: 1_000 }),
                RequestIdTestPlugin,
            ],
        }),
    );
    const baseUrl = `http://localhost:${activeConfig.apiOptions.port}`;
    const adminApiUrl = `${baseUrl}/${activeConfig.apiOptions.adminApiPath}`;
    let stdOutSpy: MockInstance<typeof process.stdout.write>;

    beforeAll(async () => {
        // Collects the JSON log lines, and keeps them out of the test output.
        stdOutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    beforeEach(() => {
        stdOutSpy.mockClear();
    });

    afterAll(async () => {
        await server.destroy();
        stdOutSpy.mockRestore();
    });

    function logLines(): LogLine[] {
        return stdOutSpy.mock.calls
            .map(call => String(call[0]))
            .filter(output => output.startsWith('{'))
            .map(output => JSON.parse(output) as LogLine);
    }

    async function waitForProcessedJob(jobId: string): Promise<ProcessedRequestIdJob> {
        for (let i = 0; i < 100; i++) {
            const processed = RequestIdTestPlugin.processedJobs.find(job => job.jobId === jobId);
            if (processed) {
                return processed;
            }
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw new Error(`Job ${jobId} was not processed`);
    }

    function queryAdministrators(headers: Record<string, string> = {}) {
        return fetch(adminApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...headers },
            body: JSON.stringify({ query: '{ administrators { totalItems } }' }),
        });
    }

    it('returns an inbound x-request-id in the response', async () => {
        const response = await queryAdministrators({ 'x-request-id': 'e2e-inbound-1' });

        expect(response.headers.get('x-request-id')).toBe('e2e-inbound-1');
    });

    it('generates an ID for a request without one', async () => {
        const response = await queryAdministrators();

        expect(response.headers.get('x-request-id')).toMatch(UUID);
    });

    it('replaces an unsafe inbound ID with a generated one', async () => {
        const response = await queryAdministrators({ 'x-request-id': 'a'.repeat(200) });

        expect(response.headers.get('x-request-id')).toMatch(UUID);
    });

    it('writes the request ID and the error code on the log line of a GraphQL error', async () => {
        // An anonymous administrators query fails with a FORBIDDEN error, logged at the verbose level.
        await queryAdministrators({ 'x-request-id': 'e2e-graphql-error' });

        const line = logLines().find(l => l.code === 'FORBIDDEN');
        expect(line).toMatchObject({ level: 'verbose', requestId: 'e2e-graphql-error' });
    });

    describe('a request which adds a job', () => {
        let ctxRequestId: string;
        let processed: ProcessedRequestIdJob;
        let lines: LogLine[];

        beforeAll(async () => {
            stdOutSpy.mockClear();
            const response = await adminClient.fetch(`${baseUrl}/request-id-test`, {
                headers: { 'x-request-id': 'e2e-with-job' },
            });
            const body = await response.json();
            ctxRequestId = body.ctxRequestId;
            processed = await waitForProcessedJob(body.jobId);
            lines = logLines();
        });

        it('has the ID on its RequestContext', () => {
            expect(ctxRequestId).toBe('e2e-with-job');
        });

        it('writes the ID on the log lines written while handling it', () => {
            const line = lines.find(
                l => l.ctx === REQUEST_ID_TEST_LOGGER_CTX && l.msg === 'Handling the request',
            );
            expect(line?.requestId).toBe('e2e-with-job');
        });

        it('stores the ID on the job', () => {
            expect(processed.jobRequestId).toBe('e2e-with-job');
        });

        it('processes the job with the ID as the current request ID', () => {
            expect(processed.currentRequestId).toBe('e2e-with-job');
        });

        it('writes the ID on the log lines written while processing the job', () => {
            const line = lines.find(
                l => l.ctx === REQUEST_ID_TEST_LOGGER_CTX && l.msg === `Processing job ${processed.jobId}`,
            );
            expect(line?.requestId).toBe('e2e-with-job');
        });

        it('keeps the ID on a RequestContext serialized into the job data', () => {
            expect(processed.ctxRequestId).toBe('e2e-with-job');
        });

        it('leaves the stored ID out of the job data', async () => {
            await adminClient.asSuperAdmin();
            const { job } = await adminClient.query(getJobDataDocument, { id: processed.jobId });

            expect(Object.keys(job.data)).toEqual(['ctx']);
        });
    });
});
