/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ErrorCode, HistoryEntryType } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { mergeConfig, NativeAuthenticationStrategy } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    TestAuthenticationStrategy,
    TestAuthenticationStrategy2,
    TestSSOStrategyAdmin,
    TestSSOStrategyShop,
    VALID_AUTH_TOKEN,
} from './fixtures/test-authentication-strategies';
import { currentUserFragment, customerFragment } from './graphql/fragments-admin';
import { FragmentOf } from './graphql/graphql-admin';
import {
    attemptLoginDocument,
    authenticateDocument,
    createCustomerDocument,
    deleteCustomerDocument,
    getCustomerHistoryDocument,
    getCustomersDocument,
    getCustomerUserAuthDocument,
    MeDocument,
} from './graphql/shared-definitions';
import { registerAccountDocument } from './graphql/shop-definitions';

type CurrentUserFragmentType = FragmentOf<typeof currentUserFragment>;
const currentUserGuard: ErrorResultGuard<CurrentUserFragmentType> = createErrorResultGuard(
    input => input.identifier != null,
);

type CustomerFragmentType = FragmentOf<typeof customerFragment>;
const customerGuard: ErrorResultGuard<CustomerFragmentType> = createErrorResultGuard(
    input => input.emailAddress != null,
);

describe('AuthenticationStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                shopAuthenticationStrategy: [
                    new NativeAuthenticationStrategy(),
                    new TestAuthenticationStrategy(),
                    new TestAuthenticationStrategy2(),
                    new TestSSOStrategyShop(),
                ],
                adminAuthenticationStrategy: [new NativeAuthenticationStrategy(), new TestSSOStrategyAdmin()],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('external auth', () => {
        const userData = {
            email: 'test@email.com',
            firstName: 'Cixin',
            lastName: 'Liu',
        };
        let newCustomerId: string;

        it('fails with a bad token', async () => {
            const { authenticate } = await shopClient.query(authenticateDocument, {
                input: {
                    test_strategy: {
                        token: 'bad-token',
                    },
                },
            });

            expect(authenticate.message).toBe('The provided credentials are invalid');
            expect(authenticate.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
            expect(authenticate.authenticationError).toBe('');
        });

        it('fails with an expired token', async () => {
            const { authenticate } = await shopClient.query(authenticateDocument, {
                input: {
                    test_strategy: {
                        token: 'expired-token',
                    },
                },
            });

            expect(authenticate.message).toBe('The provided credentials are invalid');
            expect(authenticate.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
            expect(authenticate.authenticationError).toBe('Expired token');
        });

        it('creates a new Customer with valid token', async () => {
            const { customers: before } = await adminClient.query(getCustomersDocument);
            expect(before.totalItems).toBe(1);

            const { authenticate } = await shopClient.query(authenticateDocument, {
                input: {
                    test_strategy: {
                        token: VALID_AUTH_TOKEN,
                        userData,
                    },
                },
            });
            currentUserGuard.assertSuccess(authenticate);

            expect(authenticate.identifier).toEqual(userData.email);

            const { customers: after } = await adminClient.query(getCustomersDocument);
            expect(after.totalItems).toBe(2);
            expect(after.items.map(i => i.emailAddress)).toEqual([
                'hayden.zieme12@hotmail.com',
                userData.email,
            ]);
            newCustomerId = after.items[1].id;
        });

        it('creates customer history entry', async () => {
            const { customer } = await adminClient.query(getCustomerHistoryDocument, {
                id: newCustomerId,
            });

            expect(
                customer?.history.items.sort((a, b) => (a.id > b.id ? 1 : -1)).map(pick(['type', 'data'])),
            ).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_REGISTERED,
                    data: {
                        strategy: 'test_strategy',
                    },
                },
                {
                    type: HistoryEntryType.CUSTOMER_VERIFIED,
                    data: {
                        strategy: 'test_strategy',
                    },
                },
            ]);
        });

        it('user authenticationMethod populated', async () => {
            const { customer } = await adminClient.query(getCustomerUserAuthDocument, {
                id: newCustomerId,
            });

            expect(customer?.user?.authenticationMethods.length).toBe(1);
            expect(customer?.user?.authenticationMethods[0].strategy).toBe('test_strategy');
        });

        it('creates authenticated session', async () => {
            const { me } = await shopClient.query(MeDocument);

            expect(me?.identifier).toBe(userData.email);
        });

        it('log out', async () => {
            await shopClient.asAnonymousUser();
        });

        it('logging in again re-uses created User & Customer', async () => {
            const { authenticate } = await shopClient.query(authenticateDocument, {
                input: {
                    test_strategy: {
                        token: VALID_AUTH_TOKEN,
                        userData,
                    },
                },
            });
            currentUserGuard.assertSuccess(authenticate);
            expect(authenticate.identifier).toEqual(userData.email);

            const { customers: after } = await adminClient.query(getCustomersDocument);
            expect(after.totalItems).toBe(2);
            expect(after.items.map(i => i.emailAddress)).toEqual([
                'hayden.zieme12@hotmail.com',
                userData.email,
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/695
        it('multiple external auth strategies to not interfere with one another', async () => {
            const EXPECTED_CUSTOMERS = [
                {
                    emailAddress: 'hayden.zieme12@hotmail.com',
                    id: 'T_1',
                },
                {
                    emailAddress: 'test@email.com',
                    id: 'T_2',
                },
            ];

            const { customers: customers1 } = await adminClient.query(getCustomersDocument);
            expect(customers1.items).toEqual(EXPECTED_CUSTOMERS);
            const { authenticate: auth1 } = await shopClient.query(authenticateDocument, {
                input: {
                    test_strategy2: {
                        token: VALID_AUTH_TOKEN,
                        email: userData.email,
                    },
                },
            });

            currentUserGuard.assertSuccess(auth1);
            expect(auth1.identifier).toBe(userData.email);

            const { customers: customers2 } = await adminClient.query(getCustomersDocument);
            expect(customers2.items).toEqual(EXPECTED_CUSTOMERS);

            await shopClient.asAnonymousUser();

            const { authenticate: auth2 } = await shopClient.query(authenticateDocument, {
                input: {
                    test_strategy: {
                        token: VALID_AUTH_TOKEN,
                        userData,
                    },
                },
            });

            currentUserGuard.assertSuccess(auth2);
            expect(auth2.identifier).toBe(userData.email);

            const { customers: customers3 } = await adminClient.query(getCustomersDocument);
            expect(customers3.items).toEqual(EXPECTED_CUSTOMERS);
        });

        it('registerCustomerAccount with external email', async () => {
            const successErrorGuard: ErrorResultGuard<{ success: boolean }> = createErrorResultGuard(
                input => input.success != null,
            );

            const { registerCustomerAccount } = await shopClient.query(registerAccountDocument, {
                input: {
                    emailAddress: userData.email,
                },
            });
            successErrorGuard.assertSuccess(registerCustomerAccount);

            expect(registerCustomerAccount.success).toBe(true);
            const { customer } = await adminClient.query(getCustomerUserAuthDocument, {
                id: newCustomerId,
            });

            expect(customer?.user?.authenticationMethods.length).toBe(3);
            expect(customer?.user?.authenticationMethods.map(m => m.strategy)).toEqual([
                'test_strategy',
                'test_strategy2',
                'native',
            ]);

            const { customer: customer2 } = await adminClient.query(getCustomerHistoryDocument, {
                id: newCustomerId,
                options: {
                    skip: 4,
                },
            });

            expect(customer2?.history.items.map(pick(['type', 'data']))).toEqual([
                {
                    type: HistoryEntryType.CUSTOMER_REGISTERED,
                    data: {
                        strategy: 'native',
                    },
                },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/926
        it('Customer and Admin external auth does not reuse same User for different strategies', async () => {
            const emailAddress = 'hello@test-domain.com';
            await adminClient.asAnonymousUser();
            const { authenticate: adminAuth } = await adminClient.query(authenticateDocument, {
                input: {
                    test_sso_strategy_admin: {
                        email: emailAddress,
                    },
                },
            });
            currentUserGuard.assertSuccess(adminAuth);

            const { authenticate: shopAuth } = await shopClient.query(authenticateDocument, {
                input: {
                    test_sso_strategy_shop: {
                        email: emailAddress,
                    },
                },
            });
            currentUserGuard.assertSuccess(shopAuth);

            expect(adminAuth.id).not.toBe(shopAuth.id);
        });
    });

    describe('native auth', () => {
        const testEmailAddress = 'test-person@testdomain.com';

        // https://github.com/vendurehq/vendure/issues/486#issuecomment-704991768
        it('allows login for an email address which is shared by a previously-deleted Customer', async () => {
            const { createCustomer: result1 } = await adminClient.query(createCustomerDocument, {
                input: {
                    firstName: 'Test',
                    lastName: 'Person',
                    emailAddress: testEmailAddress,
                },
                password: 'password1',
            });
            customerGuard.assertSuccess(result1);

            await adminClient.query(deleteCustomerDocument, {
                id: result1.id,
            });

            const { createCustomer: result2 } = await adminClient.query(createCustomerDocument, {
                input: {
                    firstName: 'Test',
                    lastName: 'Person',
                    emailAddress: testEmailAddress,
                },
                password: 'password2',
            });
            customerGuard.assertSuccess(result2);

            const { authenticate } = await shopClient.query(authenticateDocument, {
                input: {
                    native: {
                        username: testEmailAddress,
                        password: 'password2',
                    },
                },
            });
            currentUserGuard.assertSuccess(authenticate);

            expect(pick(authenticate, ['id', 'identifier'])).toEqual({
                id: result2.user!.id,
                identifier: result2.emailAddress,
            });
        });
    });
});

describe('No NativeAuthStrategy on Shop API', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            authOptions: {
                shopAuthenticationStrategy: [new TestAuthenticationStrategy()],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // https://github.com/vendurehq/vendure/issues/2282
    it('can log in to Admin API', async () => {
        const { login } = await adminClient.query(attemptLoginDocument, {
            username: 'superadmin',
            password: 'superadmin',
        });

        currentUserGuard.assertSuccess(login);
        expect(login.identifier).toBe('superadmin');
    });
});
