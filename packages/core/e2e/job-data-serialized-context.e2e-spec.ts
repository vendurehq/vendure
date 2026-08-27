import { JobState } from '@vendure/common/lib/generated-types';
import {
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    mergeConfig,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

/**
 * Regression test for GHSA-32jm-mf7r-7qw5 and GHSA-x6ff-hvpj-gpvr.
 *
 * A serialized RequestContext is persisted verbatim in job data, and job data is readable over
 * the Admin API. `RequestContext.serialize()` must therefore never write the session token or the
 * Express request, whose headers include `authorization` and `cookie`. These tests read the
 * persisted `job_record` rows, so they cover what is stored and not only what the API returns.
 */
const activeConfig = testConfig();

const getJobStateDocument = gql`
    query GetJobState($jobId: ID!) {
        job(jobId: $jobId) {
            id
            state
        }
    }
`;

const reindexDocument = gql`
    mutation Reindex {
        reindex {
            id
        }
    }
`;

describe('Serialized RequestContext in persisted job data', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [
                DefaultJobQueuePlugin.init({ pollInterval: 50, gracefulShutdownTimeout: 1_000 }),
                DefaultSearchPlugin,
            ],
        }),
    );

    let jobId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        // A privileged operation which enqueues a job carrying the serialized RequestContext of
        // an authenticated administrator.
        const { reindex } = await adminClient.query(reindexDocument);
        jobId = reindex.id;
        // Waiting for the job to complete proves that the allowlisted fields are enough for
        // the worker to rebuild a usable context and index the catalogue.
        await waitForJobToComplete();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function waitForJobToComplete() {
        for (let i = 0; i < 100; i++) {
            const { job } = await adminClient.query(getJobStateDocument, { jobId });
            if (job.state === JobState.COMPLETED) {
                return;
            }
            if (job.state === JobState.FAILED || job.state === JobState.CANCELLED) {
                throw new Error(`The reindex job ended in state ${job.state as string}`);
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('The reindex job did not complete');
    }

    // Every serialized context in the table, including those written while populating the test
    // data. JobRecord is not exported from @vendure/core, so the repository is looked up by name.
    async function getPersistedContexts(): Promise<any[]> {
        const connection = server.app.get(TransactionalConnection);
        const records = await connection.rawConnection.getRepository('JobRecord').find();
        return records.map(record => record.data?.ctx).filter(Boolean);
    }

    it('no persisted job record holds a session token', async () => {
        const persistedContexts = await getPersistedContexts();

        expect(persistedContexts.length).toBeGreaterThan(0);
        for (const ctx of persistedContexts) {
            expect(ctx._session?.token).toBeUndefined();
        }
    });

    it('no persisted job record holds the raw request or its headers', async () => {
        const persistedContexts = await getPersistedContexts();

        expect(persistedContexts.length).toBeGreaterThan(0);
        for (const ctx of persistedContexts) {
            expect(ctx._req).toBeUndefined();
        }
    });
});
