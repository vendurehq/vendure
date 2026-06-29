import { mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import { fail } from 'assert';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    TransactionTestPlugin,
    TRIGGER_ATTEMPTED_READ_EMAIL,
    TRIGGER_ATTEMPTED_UPDATE_EMAIL,
    TRIGGER_NO_OPERATION,
} from './fixtures/test-plugins/transaction-test-plugin';
import { FragmentOf, graphql, ResultOf } from './graphql/graphql-admin';

type DBType = 'mysql' | 'postgres' | 'sqlite' | 'sqljs';

const itIfDb = (dbs: DBType[]) => {
    return dbs.includes((process.env.DB as DBType) || 'sqljs') ? it : it.skip;
};

describe('Transaction infrastructure', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [TransactionTestPlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 0,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('non-failing mutation', async () => {
        const { createTestAdministrator } = await adminClient.query(createTestAdministratorDocument, {
            emailAddress: 'test1',
            fail: false,
        });
        createdAdminGuard.assertSuccess(createTestAdministrator);

        expect(createTestAdministrator.emailAddress).toBe('test1');
        expect(createTestAdministrator.user.identifier).toBe('test1');

        const { verify } = await adminClient.query(verifyTestDocument);

        expect(verify.admins.length).toBe(2);
        expect(verify.users.length).toBe(2);
        expect(!!verify.admins.find(a => a.emailAddress === 'test1')).toBe(true);
        expect(!!verify.users.find(u => u.identifier === 'test1')).toBe(true);
    });

    it('failing mutation', async () => {
        try {
            await adminClient.query(createTestAdministratorDocument, {
                emailAddress: 'test2',
                fail: true,
            });
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toContain('Failed!');
        }

        const { verify } = await adminClient.query(verifyTestDocument);

        expect(verify.admins.length).toBe(2);
        expect(verify.users.length).toBe(2);
        expect(!!verify.admins.find(a => a.emailAddress === 'test2')).toBe(false);
        expect(!!verify.users.find(u => u.identifier === 'test2')).toBe(false);
    });

    it('failing mutation with promise concurrent execution', async () => {
        try {
            await adminClient.query(createNTestAdministratorsDocument, {
                emailAddress: 'testN-',
                failFactor: 0.4,
                n: 10,
            });
            fail('Should have thrown');
        } catch (e) {
            expect(e.message).toContain('Failed!');
        }

        const { verify } = await adminClient.query(verifyTestDocument);

        expect(verify.admins.length).toBe(2);
        expect(verify.users.length).toBe(2);
        expect(!!verify.admins.find(a => a.emailAddress.includes('testN'))).toBe(false);
        expect(!!verify.users.find(u => u.identifier.includes('testN'))).toBe(false);
    });

    it('failing manual mutation', async () => {
        try {
            await adminClient.query(createTestAdministrator2Document, {
                emailAddress: 'test3',
                fail: true,
            });
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toContain('Failed!');
        }

        const { verify } = await adminClient.query(verifyTestDocument);

        expect(verify.admins.length).toBe(2);
        expect(verify.users.length).toBe(2);
        expect(!!verify.admins.find(a => a.emailAddress === 'test3')).toBe(false);
        expect(!!verify.users.find(u => u.identifier === 'test3')).toBe(false);
    });

    it('failing manual mutation without transaction', async () => {
        try {
            await adminClient.query(createTestAdministrator3Document, {
                emailAddress: 'test4',
                fail: true,
            });
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toContain('Failed!');
        }

        const { verify } = await adminClient.query(verifyTestDocument);

        expect(verify.admins.length).toBe(2);
        expect(verify.users.length).toBe(3);
        expect(!!verify.admins.find(a => a.emailAddress === 'test4')).toBe(false);
        expect(!!verify.users.find(u => u.identifier === 'test4')).toBe(true);
    });

    it('failing mutation inside connection.withTransaction() wrapper with request context', async () => {
        try {
            await adminClient.query(createTestAdministrator5Document, {
                emailAddress: 'test5',
                fail: true,
                noContext: false,
            });
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toContain('Failed!');
        }

        const { verify } = await adminClient.query(verifyTestDocument);

        expect(verify.admins.length).toBe(2);
        expect(verify.users.length).toBe(3);
        expect(!!verify.admins.find(a => a.emailAddress === 'test5')).toBe(false);
        expect(!!verify.users.find(u => u.identifier === 'test5')).toBe(false);
    });

    itIfDb(['postgres', 'mysql'])(
        'failing mutation inside connection.withTransaction() wrapper with context and promise concurrent execution',
        async () => {
            try {
                await adminClient.query(createNTestAdministrators2Document, {
                    emailAddress: 'testN-',
                    failFactor: 0.4,
                    n: 10,
                });
                fail('Should have thrown');
            } catch (e) {
                expect(e.message).toMatch(
                    /^Failed!|Query runner already released. Cannot run queries anymore.$/,
                );
            }

            const { verify } = await adminClient.query(verifyTestDocument);

            expect(verify.admins.length).toBe(2);
            expect(verify.users.length).toBe(3);
            expect(!!verify.admins.find(a => a.emailAddress.includes('testN'))).toBe(false);
            expect(!!verify.users.find(u => u.identifier.includes('testN'))).toBe(false);
        },
    );

    it('failing mutation inside connection.withTransaction() wrapper without request context', async () => {
        try {
            await adminClient.query(createTestAdministrator5Document, {
                emailAddress: 'test5',
                fail: true,
                noContext: true,
            });
            fail('Should have thrown');
        } catch (e: any) {
            expect(e.message).toContain('Failed!');
        }

        const { verify } = await adminClient.query(verifyTestDocument);

        expect(verify.admins.length).toBe(2);
        expect(verify.users.length).toBe(3);
        expect(!!verify.admins.find(a => a.emailAddress === 'test5')).toBe(false);
        expect(!!verify.users.find(u => u.identifier === 'test5')).toBe(false);
    });

    it('non-failing mutation inside connection.withTransaction() wrapper with failing nested transactions and request context', async () => {
        await adminClient.query(createNTestAdministrators3Document, {
            emailAddress: 'testNestedTransactionsN-',
            failFactor: 0.5,
            n: 2,
        });

        const { verify } = await adminClient.query(verifyTestDocument);

        expect(verify.admins.length).toBe(3);
        expect(verify.users.length).toBe(4);
        expect(verify.admins.filter(a => a.emailAddress.includes('testNestedTransactionsN'))).toHaveLength(1);
        expect(verify.users.filter(u => u.identifier.includes('testNestedTransactionsN'))).toHaveLength(1);
    });

    it('event do not publish after transaction rollback', async () => {
        TransactionTestPlugin.reset();
        try {
            await adminClient.query(createNTestAdministratorsDocument, {
                emailAddress: TRIGGER_NO_OPERATION,
                failFactor: 0.5,
                n: 2,
            });
            fail('Should have thrown');
        } catch (e) {
            expect(e.message).toContain('Failed!');
        }

        // Wait a bit to see an events in handler
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(TransactionTestPlugin.callHandler).not.toHaveBeenCalled();
        expect(TransactionTestPlugin.errorHandler).not.toHaveBeenCalled();
    });

    // Testing https://github.com/vendurehq/vendure/issues/520
    it('passing transaction via EventBus', async () => {
        TransactionTestPlugin.reset();
        const { createTestAdministrator } = await adminClient.query(createTestAdministratorDocument, {
            emailAddress: TRIGGER_ATTEMPTED_UPDATE_EMAIL,
            fail: false,
        });
        createdAdminGuard.assertSuccess(createTestAdministrator);
        await TransactionTestPlugin.eventHandlerComplete$.toPromise();
        expect(createTestAdministrator.emailAddress).toBe(TRIGGER_ATTEMPTED_UPDATE_EMAIL);
        expect(TransactionTestPlugin.errorHandler).not.toHaveBeenCalled();
    });

    // Regression test for #4708:
    // A resolver decorated with @Transaction('manual') that starts a transaction
    // and then calls a service using `connection.withTransaction(ctx, …)` must
    // remain able to perform DB operations on the same `ctx` after the inner
    // wrapper returns. The bug was that the inner wrapper released the inherited
    // QueryRunner, breaking any further DB op with QueryRunnerAlreadyReleasedError.
    // Only runs on real drivers — the sqljs `release()` is a no-op and hides the bug.
    // Placed near the end of the suite because it adds two admins to the shared
    // verifyTestDocument-visible state.
    itIfDb(['postgres', 'mysql'])(
        'inner withTransaction does not release inherited QueryRunner from manual outer transaction',
        async () => {
            const { createTestAdministrator6 } = await adminClient.query(createTestAdministrator6Document, {
                emailAddress: 'test-manual-inherited',
            });
            createdAdminGuard.assertSuccess(createTestAdministrator6);

            const { verify } = await adminClient.query(verifyTestDocument);
            expect(!!verify.admins.find(a => a.emailAddress === 'test-manual-inherited_a')).toBe(true);
            expect(!!verify.admins.find(a => a.emailAddress === 'test-manual-inherited_b')).toBe(true);
        },
    );

    // Testing https://github.com/vendurehq/vendure/issues/1107
    it('passing transaction via EventBus with delay in committing transaction', async () => {
        TransactionTestPlugin.reset();
        const { createTestAdministrator4 } = await adminClient.query(createTestAdministrator4Document, {
            emailAddress: TRIGGER_ATTEMPTED_READ_EMAIL,
            fail: false,
        });
        createdAdminGuard.assertSuccess(createTestAdministrator4);
        await TransactionTestPlugin.eventHandlerComplete$.toPromise();
        expect(createTestAdministrator4.emailAddress).toBe(TRIGGER_ATTEMPTED_READ_EMAIL);
        expect(TransactionTestPlugin.errorHandler).not.toHaveBeenCalled();
    });
});

const createdAdminFragment = graphql(`
    fragment CreatedAdmin on Administrator {
        id
        emailAddress
        user {
            id
            identifier
        }
    }
`);

type CreatedAdmin = FragmentOf<typeof createdAdminFragment>;
const createdAdminGuard: ErrorResultGuard<CreatedAdmin> = createErrorResultGuard(input => !!input.id);

const createTestAdministratorDocument = graphql(
    `
        mutation CreateTestAdmin($emailAddress: String!, $fail: Boolean!) {
            createTestAdministrator(emailAddress: $emailAddress, fail: $fail) {
                ...CreatedAdmin
            }
        }
    `,
    [createdAdminFragment],
);

const createTestAdministrator2Document = graphql(
    `
        mutation CreateTestAdmin2($emailAddress: String!, $fail: Boolean!) {
            createTestAdministrator2(emailAddress: $emailAddress, fail: $fail) {
                ...CreatedAdmin
            }
        }
    `,
    [createdAdminFragment],
);

const createTestAdministrator3Document = graphql(
    `
        mutation CreateTestAdmin3($emailAddress: String!, $fail: Boolean!) {
            createTestAdministrator3(emailAddress: $emailAddress, fail: $fail) {
                ...CreatedAdmin
            }
        }
    `,
    [createdAdminFragment],
);

const createTestAdministrator4Document = graphql(
    `
        mutation CreateTestAdmin4($emailAddress: String!, $fail: Boolean!) {
            createTestAdministrator4(emailAddress: $emailAddress, fail: $fail) {
                ...CreatedAdmin
            }
        }
    `,
    [createdAdminFragment],
);

const createTestAdministrator5Document = graphql(
    `
        mutation CreateTestAdmin5($emailAddress: String!, $fail: Boolean!, $noContext: Boolean!) {
            createTestAdministrator5(emailAddress: $emailAddress, fail: $fail, noContext: $noContext) {
                ...CreatedAdmin
            }
        }
    `,
    [createdAdminFragment],
);

const createTestAdministrator6Document = graphql(
    `
        mutation CreateTestAdmin6($emailAddress: String!) {
            createTestAdministrator6(emailAddress: $emailAddress) {
                ...CreatedAdmin
            }
        }
    `,
    [createdAdminFragment],
);

const createNTestAdministratorsDocument = graphql(`
    mutation CreateNTestAdmins($emailAddress: String!, $failFactor: Float!, $n: Int!) {
        createNTestAdministrators(emailAddress: $emailAddress, failFactor: $failFactor, n: $n)
    }
`);

const createNTestAdministrators2Document = graphql(`
    mutation CreateNTestAdmins2($emailAddress: String!, $failFactor: Float!, $n: Int!) {
        createNTestAdministrators2(emailAddress: $emailAddress, failFactor: $failFactor, n: $n)
    }
`);

const createNTestAdministrators3Document = graphql(`
    mutation CreateNTestAdmins3($emailAddress: String!, $failFactor: Float!, $n: Int!) {
        createNTestAdministrators3(emailAddress: $emailAddress, failFactor: $failFactor, n: $n)
    }
`);

const verifyTestDocument = graphql(`
    query VerifyTest {
        verify {
            admins {
                id
                emailAddress
            }
            users {
                id
                identifier
            }
        }
    }
`);

type VerifyResult = ResultOf<typeof verifyTestDocument>;
