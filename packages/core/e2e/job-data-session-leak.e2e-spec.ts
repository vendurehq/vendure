import { JobState, Permission } from '@vendure/common/lib/generated-types';
import {
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    mergeConfig,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { createAdministratorDocument, createRoleDocument } from './graphql/shared-definitions';

/**
 * Regression test for GHSA-32jm-mf7r-7qw5 and GHSA-x6ff-hvpj-gpvr.
 *
 * `RequestContext.serialize()` copies the whole cached session, including the session token
 * used for bearer authentication, into the serialized context, and that context is persisted
 * verbatim in job data. The `job` and `jobs` queries are readable by any administrator who holds
 * ReadSettings or ReadSystem, so the job data resolver must never return the token, or a
 * lower-privileged administrator can read and reuse the session token of a higher-privileged one.
 *
 * The persisted `job_record` row holds the token, so these tests read the Admin API and not the
 * table.
 */
const activeConfig = testConfig();

const getJobDataDocument = gql`
    query GetJobData($jobId: ID!) {
        job(jobId: $jobId) {
            id
            queueName
            state
            data
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

describe('Serialized RequestContext in job data', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [
                DefaultJobQueuePlugin.init({ pollInterval: 50, gracefulShutdownTimeout: 1_000 }),
                DefaultSearchPlugin,
            ],
        }),
    );

    const restrictedAdminIdentifier = 'read-settings@test.com';
    const restrictedAdminPassword = 'test';

    let restrictedClient: SimpleGraphQLClient;
    let superAdminSessionToken: string;
    let jobId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        // Admin B holds only ReadSettings, which is all the `jobs` query requires.
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                channelIds: ['T_1'],
                code: 'read-settings-only',
                description: 'Read settings only',
                permissions: [Permission.ReadSettings],
            },
        });
        await adminClient.query(createAdministratorDocument, {
            input: {
                firstName: 'Read',
                lastName: 'Settings',
                emailAddress: restrictedAdminIdentifier,
                password: restrictedAdminPassword,
                roleIds: [createRole.id],
            },
        });

        // Admin A runs a privileged operation which enqueues a job carrying its serialized
        // RequestContext. The bearer token used by the client is the session token.
        superAdminSessionToken = adminClient.getAuthToken();
        expect(superAdminSessionToken).toBeTruthy();
        const { reindex } = await adminClient.query(reindexDocument);
        jobId = reindex.id;
        // Waiting for the job to complete proves that the worker can still rebuild a usable
        // context and index the catalogue.
        await waitForJobToComplete();

        const { port, adminApiPath } = activeConfig.apiOptions;
        restrictedClient = new SimpleGraphQLClient(
            activeConfig,
            `http://localhost:${port}/${adminApiPath as string}`,
        );
        await restrictedClient.asUserWithCredentials(restrictedAdminIdentifier, restrictedAdminPassword);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function waitForJobToComplete() {
        for (let i = 0; i < 100; i++) {
            const { job } = await adminClient.query(getJobDataDocument, { jobId });
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

    it('the `job` query does not expose another administrator session token', async () => {
        const { job } = await restrictedClient.query(getJobDataDocument, { jobId });

        expect(job.state).toBe(JobState.COMPLETED);
        expect(job.data.ctx).toBeDefined();
        expect(job.data.ctx._session.token).toBeUndefined();
        expect(job.data.ctx._req).toBeUndefined();
        expect(JSON.stringify(job)).not.toContain(superAdminSessionToken);
    });

    // A row inserted straight into `job_record`, in the shape `serialize()` writes, with a token
    // and the request headers. The `job` query must not hand either out, whichever plugin or
    // version wrote the row.
    it('the `job` query strips the session token from a job record inserted directly', async () => {
        const connection = server.app.get(TransactionalConnection);
        const legacyToken = 'legacy-session-token';
        // JobRecord is not exported from @vendure/core, so the repository is looked up by name.
        const { id: legacyRecordId } = await connection.rawConnection.getRepository('JobRecord').save({
            queueName: 'legacy-queue',
            state: JobState.COMPLETED,
            progress: 100,
            isSettled: true,
            retries: 0,
            attempts: 1,
            data: {
                ctx: {
                    _apiType: 'admin',
                    _channel: { id: 1, code: '__default_channel__' },
                    _languageCode: 'en',
                    _isAuthorized: true,
                    _authorizedAsOwnerOnly: false,
                    _session: {
                        id: 1,
                        token: legacyToken,
                        user: { id: 1, identifier: 'superadmin', channelPermissions: [] },
                    },
                    _req: { headers: { authorization: `Bearer ${legacyToken}` } },
                },
            },
        });

        const { job } = await restrictedClient.query(getJobDataDocument, {
            jobId: `T_${String(legacyRecordId)}`,
        });

        expect(job.queueName).toBe('legacy-queue');
        expect(job.data.ctx._session.token).toBeUndefined();
        expect(job.data.ctx._req).toBeUndefined();
        expect(JSON.stringify(job)).not.toContain(legacyToken);
    });
});
