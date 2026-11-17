import { OnApplicationBootstrap } from '@nestjs/common';
import { JobState, Permission } from '@vendure/common/lib/generated-types';
import {
    AdministratorPasswordResetEvent,
    DefaultJobQueuePlugin,
    DefaultSearchPlugin,
    EventBus,
    JobQueueService,
    mergeConfig,
    NativeAuthenticationMethod,
    PasswordResetEvent,
    PluginCommonModule,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createAdministratorDocument,
    createRoleDocument,
    requestAdminPasswordResetDocument,
} from './graphql/shared-definitions';
import { requestPasswordResetDocument } from './graphql/shop-definitions';
import { pollUntil } from './utils/poll-until';

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

const getJobsDataDocument = gql`
    query GetJobsData($options: JobListOptions) {
        jobs(options: $options) {
            items {
                id
                queueName
                state
                data
                result
                error
            }
        }
    }
`;

const getJobsByIdDataDocument = gql`
    query GetJobsByIdData($jobIds: [ID!]!) {
        jobsById(jobIds: $jobIds) {
            id
            queueName
            data
            result
            error
        }
    }
`;

const cancelJobDataDocument = gql`
    mutation CancelJobData($jobId: ID!) {
        cancelJob(jobId: $jobId) {
            id
            state
            data
        }
    }
`;

const getCustomerEmailsDocument = gql`
    query GetCustomerEmails {
        customers(options: { take: 1 }) {
            items {
                emailAddress
            }
        }
    }
`;

/**
 * Enqueues `send-email` jobs the way the EmailPlugin default handlers do: the password reset
 * token is copied into `templateVars`. Core e2e tests cannot depend on the EmailPlugin.
 */
@VendurePlugin({ imports: [PluginCommonModule] })
class PasswordResetMailQueuePlugin implements OnApplicationBootstrap {
    constructor(
        private eventBus: EventBus,
        private jobQueueService: JobQueueService,
    ) {}

    async onApplicationBootstrap() {
        const queue = await this.jobQueueService.createQueue<any>({
            name: 'send-email',
            process: async () => undefined,
        });
        this.eventBus.ofType(PasswordResetEvent).subscribe(event => {
            void queue.add({
                ctx: event.ctx.serialize(),
                type: 'password-reset',
                recipient: event.user.identifier,
                templateVars: {
                    passwordResetToken: event.user.getNativeAuthenticationMethod().passwordResetToken,
                },
            });
        });
        this.eventBus.ofType(AdministratorPasswordResetEvent).subscribe(event => {
            void queue.add({
                ctx: event.ctx.serialize(),
                type: 'admin-password-reset',
                recipient: event.administrator.emailAddress,
                templateVars: {
                    passwordResetToken: event.user.getNativeAuthenticationMethod().passwordResetToken,
                },
            });
        });
    }
}

/** Reads one job through each of `job`, `jobs` and `jobsById`. */
async function readJobThroughAllQueries(client: SimpleGraphQLClient, jobId: string) {
    const { job } = await client.query(getJobDataDocument, { jobId });
    const { jobs } = await client.query(getJobsDataDocument, {
        options: { filter: { id: { eq: jobId } } },
    });
    const { jobsById } = await client.query(getJobsByIdDataDocument, { jobIds: [jobId] });
    expect(job.id).toBe(jobId);
    expect(jobs.items.map((j: any) => j.id)).toEqual([jobId]);
    expect(jobsById.map((j: any) => j.id)).toEqual([jobId]);
    return { job, jobs: jobs.items[0], jobsById: jobsById[0] };
}

describe('Serialized RequestContext in job data', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(activeConfig, {
            plugins: [
                DefaultJobQueuePlugin.init({ pollInterval: 50, gracefulShutdownTimeout: 1_000 }),
                DefaultSearchPlugin,
                PasswordResetMailQueuePlugin,
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

    // The EmailPlugin default handlers write the password reset,
    // verification and identifier change tokens into `templateVars`. An administrator who can
    // read jobs could use them to take over the account, so none of them may be returned.
    describe('send-email job data', () => {
        const secrets = {
            passwordResetToken: 'e2e-secret-password-reset-token',
            verificationToken: 'e2e-secret-verification-token',
            identifierChangeToken: 'e2e-secret-identifier-change-token',
            passwordHash: 'e2e-secret-password-hash',
            attachmentContent: 'e2e-secret-attachment-content',
            attachmentPath: 'https://bucket.test/invoice.pdf?X-Amz-Signature=e2e-secret-presigned',
            channelCustomField: 'e2e-secret-channel-custom-field',
        };
        let sendEmailJobId: string;

        beforeAll(async () => {
            const connection = server.app.get(TransactionalConnection);
            const { id } = await connection.rawConnection.getRepository('JobRecord').save({
                queueName: 'send-email',
                state: JobState.COMPLETED,
                progress: 100,
                isSettled: true,
                retries: 0,
                attempts: 1,
                data: {
                    ctx: {
                        _apiType: 'shop',
                        _channel: {
                            id: 1,
                            code: '__default_channel__',
                            token: 'e2e-default-channel',
                            customFields: { notes: secrets.channelCustomField },
                        },
                        _languageCode: 'en',
                        _isAuthorized: false,
                        _authorizedAsOwnerOnly: false,
                        _session: {},
                    },
                    type: 'password-reset',
                    recipient: 'victim@test.com',
                    templateVars: {
                        passwordResetToken: secrets.passwordResetToken,
                        verificationToken: secrets.verificationToken,
                        identifierChangeToken: secrets.identifierChangeToken,
                    },
                    user: {
                        identifier: 'victim@test.com',
                        authenticationMethods: [{ id: 1, passwordHash: secrets.passwordHash }],
                    },
                    attachments: [
                        {
                            filename: 'invoice.pdf',
                            contentType: 'application/pdf',
                            content: JSON.stringify(secrets.attachmentContent),
                            path: secrets.attachmentPath,
                        },
                    ],
                },
            });
            sendEmailJobId = `T_${String(id)}`;
        });

        function expectNoSecrets(response: unknown) {
            const serialized = JSON.stringify(response);
            for (const secret of Object.values(secrets)) {
                expect(serialized).not.toContain(secret);
            }
        }

        it('job, jobs and jobsById return no secret to a ReadSettings administrator', async () => {
            const responses = await readJobThroughAllQueries(restrictedClient, sendEmailJobId);

            expectNoSecrets(responses);
            for (const job of Object.values(responses)) {
                expect(job.data.templateVars).toEqual({
                    passwordResetToken: '[redacted]',
                    verificationToken: '[redacted]',
                    identifierChangeToken: '[redacted]',
                });
                expect(job.data.user.authenticationMethods[0].passwordHash).toBe('[redacted]');
                expect(job.data.attachments).toEqual([
                    { filename: 'invoice.pdf', contentType: 'application/pdf' },
                ]);
                expect(job.data.ctx._channel).toEqual({
                    // The e2e entity id strategy encodes every `id` in the response.
                    id: 'T_1',
                    code: '__default_channel__',
                    token: 'e2e-default-channel',
                });
                expect(job.data.recipient).toBe('victim@test.com');
            }
        });

        it('job, jobs and jobsById return no secret to a SuperAdmin', async () => {
            const responses = await readJobThroughAllQueries(adminClient, sendEmailJobId);

            expectNoSecrets(responses);
        });

        it('requestPasswordReset does not expose the reset token through the jobs query', async () => {
            const { customers } = await adminClient.query(getCustomerEmailsDocument);
            const emailAddress: string = customers.items[0].emailAddress;
            const { requestPasswordReset } = await shopClient.query(requestPasswordResetDocument, {
                identifier: emailAddress,
            });
            expect(requestPasswordReset).toEqual({ success: true });

            const connection = server.app.get(TransactionalConnection);
            const authMethod = await connection.rawConnection
                .getRepository(NativeAuthenticationMethod)
                .findOneOrFail({ where: { identifier: emailAddress } });
            const resetToken = authMethod.passwordResetToken;
            expect(resetToken).toBeTruthy();

            let resetJob: any;
            await pollUntil(async () => {
                const { jobs } = await restrictedClient.query(getJobsDataDocument, {
                    options: { filter: { queueName: { eq: 'send-email' } }, take: 100 },
                });
                resetJob = jobs.items.find((j: any) => j.data?.recipient === emailAddress);
                return !!resetJob;
            });

            expect(Object.keys(resetJob.data.templateVars)).toEqual(['passwordResetToken']);
            expect(JSON.stringify(resetJob)).not.toContain(resetToken);
        });

        // The Admin API password reset flow publishes the Administrator's token to the same
        // queue, so the job data would let a ReadSettings administrator reset the SuperAdmin's
        // password.
        it('Admin API requestPasswordReset does not expose the reset token through the jobs query', async () => {
            const { requestPasswordReset } = await restrictedClient.query(requestAdminPasswordResetDocument, {
                emailAddress: 'superadmin',
            });
            expect(requestPasswordReset).toEqual({ success: true });

            const connection = server.app.get(TransactionalConnection);
            const authMethod = await connection.rawConnection
                .getRepository(NativeAuthenticationMethod)
                .findOneOrFail({ where: { identifier: 'superadmin' } });
            const resetToken = authMethod.passwordResetToken;
            expect(resetToken).toBeTruthy();

            let resetJob: any;
            await pollUntil(async () => {
                const { jobs } = await restrictedClient.query(getJobsDataDocument, {
                    options: { filter: { queueName: { eq: 'send-email' } }, take: 100 },
                });
                resetJob = jobs.items.find((j: any) => j.data?.type === 'admin-password-reset');
                return !!resetJob;
            });

            expect(resetJob.data.templateVars).toEqual({ passwordResetToken: '[redacted]' });
            expect(JSON.stringify(resetJob)).not.toContain(resetToken);
        });

        // `cancelJob` returns the Job too, and needs only DeleteSettings or DeleteSystem.
        it('cancelJob does not return secrets to a DeleteSettings administrator', async () => {
            const { createRole } = await adminClient.query(createRoleDocument, {
                input: {
                    channelIds: ['T_1'],
                    code: 'delete-settings-only',
                    description: 'Delete settings only',
                    permissions: [Permission.DeleteSettings],
                },
            });
            await adminClient.query(createAdministratorDocument, {
                input: {
                    firstName: 'Delete',
                    lastName: 'Settings',
                    emailAddress: 'delete-settings@test.com',
                    password: 'test',
                    roleIds: [createRole.id],
                },
            });
            const { port, adminApiPath } = activeConfig.apiOptions;
            const deleteSettingsClient = new SimpleGraphQLClient(
                activeConfig,
                `http://localhost:${port}/${adminApiPath as string}`,
            );
            await deleteSettingsClient.asUserWithCredentials('delete-settings@test.com', 'test');

            // A queue without a worker, so the job stays pending until it is cancelled.
            const connection = server.app.get(TransactionalConnection);
            const { id } = await connection.rawConnection.getRepository('JobRecord').save({
                queueName: 'unprocessed-mail',
                state: JobState.PENDING,
                progress: 0,
                isSettled: false,
                retries: 0,
                attempts: 0,
                data: {
                    recipient: 'victim@test.com',
                    templateVars: { passwordResetToken: secrets.passwordResetToken },
                },
            });

            const { cancelJob } = await deleteSettingsClient.query(cancelJobDataDocument, {
                jobId: `T_${String(id)}`,
            });

            expect(cancelJob.state).toBe(JobState.CANCELLED);
            expect(cancelJob.data.templateVars).toEqual({ passwordResetToken: '[redacted]' });
            expectNoSecrets(cancelJob);
        });
    });
});
