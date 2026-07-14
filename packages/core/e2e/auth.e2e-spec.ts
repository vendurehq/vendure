/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ErrorCode, Permission } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_IDENTIFIER, SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import { DocumentNode } from 'graphql';
import path from 'path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { Issue2097Plugin } from './fixtures/test-plugins/issue-2097-plugin';
import { ProtectedFieldsPlugin, transactions } from './fixtures/test-plugins/with-protected-field-resolver';
import {
    canCreateCustomerDocument,
    deepFieldResolutionTestQueryDocument,
    getCustomerCountDocument,
    getProductWithTransactionsDocument,
    issue2097QueryDocument,
} from './graphql/admin-definitions';
import { currentUserFragment } from './graphql/fragments-admin';
import { ResultOf } from './graphql/graphql-admin';
import {
    attemptLoginDocument,
    createAdministratorDocument,
    createCustomerDocument,
    createCustomerGroupDocument,
    createProductDocument,
    createRoleDocument,
    getCustomerListDocument,
    getProductListDocument,
    getTaxRatesListDocument,
    MeDocument,
    updateProductDocument,
    updateTaxRateDocument,
} from './graphql/shared-definitions';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const productResultGuard: ErrorResultGuard<
    NonNullable<ResultOf<typeof getProductWithTransactionsDocument>['product']>
> = createErrorResultGuard(input => !!input && 'id' in input);

describe('Authorization & permissions', () => {
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...testConfig(),
        plugins: [ProtectedFieldsPlugin, Issue2097Plugin],
    });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 5,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('admin permissions', () => {
        describe('Anonymous user', () => {
            beforeAll(async () => {
                await adminClient.asAnonymousUser();
            });

            it(
                'me is not permitted',
                assertThrowsWithMessage(async () => {
                    await adminClient.query(MeDocument);
                }, 'You are not currently authorized to perform this action'),
            );

            it('can attempt login', async () => {
                await assertRequestAllowed(attemptLoginDocument, {
                    username: SUPER_ADMIN_USER_IDENTIFIER,
                    password: SUPER_ADMIN_USER_PASSWORD,
                    rememberMe: false,
                });
            });
        });

        describe('Customer user', () => {
            let customerEmailAddress: string;
            beforeAll(async () => {
                await adminClient.asSuperAdmin();
                const { customers } = await adminClient.query(getCustomerListDocument);
                customerEmailAddress = customers.items[0].emailAddress;
            });

            it('cannot login', async () => {
                const result = await adminClient.asUserWithCredentials(customerEmailAddress, 'test');

                expect(result.errorCode).toBe(ErrorCode.INVALID_CREDENTIALS_ERROR);
            });
        });

        describe('ReadCatalog permission', () => {
            beforeAll(async () => {
                await adminClient.asSuperAdmin();
                const { identifier, password } = await createAdministratorWithPermissions('ReadCatalog', [
                    Permission.ReadCatalog,
                ]);
                await adminClient.asUserWithCredentials(identifier, password);
            });

            it('me returns correct permissions', async () => {
                const result = await adminClient.query(MeDocument);

                expect(result.me!.channels[0].permissions).toEqual([
                    Permission.Authenticated,
                    Permission.ReadCatalog,
                ]);
            });

            it('can read', async () => {
                await assertRequestAllowed(getProductListDocument);
            });

            it('cannot update', async () => {
                await assertRequestForbidden(updateProductDocument, {
                    input: {
                        id: '1',
                        translations: [],
                    },
                });
            });

            it('cannot create', async () => {
                await assertRequestForbidden(createProductDocument, {
                    input: {
                        translations: [],
                    },
                });
            });
        });

        describe('CRUD on Customers permissions', () => {
            beforeAll(async () => {
                await adminClient.asSuperAdmin();
                const { identifier, password } = await createAdministratorWithPermissions('CRUDCustomer', [
                    Permission.CreateCustomer,
                    Permission.ReadCustomer,
                    Permission.UpdateCustomer,
                    Permission.DeleteCustomer,
                ]);
                await adminClient.asUserWithCredentials(identifier, password);
            });

            it('me returns correct permissions', async () => {
                const result = await adminClient.query(MeDocument);

                expect(result.me!.channels[0].permissions).toEqual([
                    Permission.Authenticated,
                    Permission.CreateCustomer,
                    Permission.ReadCustomer,
                    Permission.UpdateCustomer,
                    Permission.DeleteCustomer,
                ]);
            });

            it('can create', async () => {
                await assertRequestAllowed(canCreateCustomerDocument, {
                    input: { emailAddress: '', firstName: '', lastName: '' },
                });
            });

            it('can read', async () => {
                await assertRequestAllowed(getCustomerCountDocument);
            });
        });
    });

    describe('administrator and customer users with the same email address', () => {
        const emailAddress = 'same-email@test.com';
        const adminPassword = 'admin-password';
        const customerPassword = 'customer-password';

        const loginErrorGuard: ErrorResultGuard<ResultOf<typeof currentUserFragment>> =
            createErrorResultGuard(input => !!input.identifier);

        beforeAll(async () => {
            await adminClient.asSuperAdmin();

            await adminClient.query(createAdministratorDocument, {
                input: {
                    emailAddress,
                    firstName: 'First',
                    lastName: 'Last',
                    password: adminPassword,
                    roleIds: ['1'],
                },
            });

            await adminClient.query(createCustomerDocument, {
                input: {
                    emailAddress,
                    firstName: 'First',
                    lastName: 'Last',
                },
                password: customerPassword,
            });
        });

        beforeEach(async () => {
            await adminClient.asAnonymousUser();
            await shopClient.asAnonymousUser();
        });

        it('can log in as an administrator', async () => {
            const loginResult = await adminClient.query(attemptLoginDocument, {
                username: emailAddress,
                password: adminPassword,
            });

            loginErrorGuard.assertSuccess(loginResult.login);
            expect(loginResult.login.identifier).toEqual(emailAddress);
        });

        it('can log in as a customer', async () => {
            const loginResult = await shopClient.query(attemptLoginDocument, {
                username: emailAddress,
                password: customerPassword,
            });

            loginErrorGuard.assertSuccess(loginResult.login);
            expect(loginResult.login.identifier).toEqual(emailAddress);
        });

        it('cannot log in as an administrator using a customer password', async () => {
            const loginResult = await adminClient.query(attemptLoginDocument, {
                username: emailAddress,
                password: customerPassword,
            });

            loginErrorGuard.assertErrorResult(loginResult.login);
            expect(loginResult.login.errorCode).toEqual(ErrorCode.INVALID_CREDENTIALS_ERROR);
        });

        it('cannot log in as a customer using an administrator password', async () => {
            const loginResult = await shopClient.query(attemptLoginDocument, {
                username: emailAddress,
                password: adminPassword,
            });

            loginErrorGuard.assertErrorResult(loginResult.login);
            expect(loginResult.login.errorCode).toEqual(ErrorCode.INVALID_CREDENTIALS_ERROR);
        });
    });

    describe('protected field resolvers', () => {
        let readCatalogAdmin: { identifier: string; password: string };
        let transactionsAdmin: { identifier: string; password: string };

        beforeAll(async () => {
            await adminClient.asSuperAdmin();
            transactionsAdmin = await createAdministratorWithPermissions('Transactions', [
                Permission.ReadCatalog,
                transactions.Permission,
            ]);
            readCatalogAdmin = await createAdministratorWithPermissions('ReadCatalog', [
                Permission.ReadCatalog,
            ]);
        });

        it('protected field not resolved without permissions', async () => {
            await adminClient.asUserWithCredentials(readCatalogAdmin.identifier, readCatalogAdmin.password);

            try {
                const status = await adminClient.query(getProductWithTransactionsDocument, { id: 'T_1' });
                fail('Should have thrown');
            } catch (e: any) {
                expect(getErrorCode(e)).toBe('FORBIDDEN');
            }
        });

        it('protected field is resolved with permissions', async () => {
            await adminClient.asUserWithCredentials(transactionsAdmin.identifier, transactionsAdmin.password);

            const { product } = await adminClient.query(getProductWithTransactionsDocument, { id: 'T_1' });

            productResultGuard.assertSuccess(product);

            expect(product.id).toBe('T_1');
            expect(product.transactions).toEqual([
                { id: 'T_1', amount: 100, description: 'credit' },
                { id: 'T_2', amount: -50, description: 'debit' },
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/730
        it('protects against deep query data leakage', async () => {
            await adminClient.asSuperAdmin();
            const { createCustomerGroup } = await adminClient.query(createCustomerGroupDocument, {
                input: {
                    name: 'Test group',
                    customerIds: ['T_1', 'T_2', 'T_3', 'T_4'],
                },
            });

            const taxRateName = `Standard Tax ${initialData.defaultZone}`;
            const { taxRates } = await adminClient.query(getTaxRatesListDocument, {
                options: {
                    filter: {
                        name: { eq: taxRateName },
                    },
                },
            });

            const standardTax = taxRates.items[0];
            expect(standardTax.name).toBe(taxRateName);

            await adminClient.query(updateTaxRateDocument, {
                input: {
                    id: standardTax.id,
                    customerGroupId: createCustomerGroup.id,
                },
            });

            try {
                const status = await shopClient.query(deepFieldResolutionTestQueryDocument, { id: 'T_1' });
                fail('Should have thrown');
            } catch (e: any) {
                expect(getErrorCode(e)).toBe('FORBIDDEN');
            }
        });

        // https://github.com/vendurehq/vendure/issues/2097
        it('does not overwrite ctx.authorizedAsOwnerOnly with multiple parallel top-level queries', async () => {
            // We run this multiple times since the error is based on a race condition that does not
            // show up consistently.
            for (let i = 0; i < 10; i++) {
                const result = await shopClient.query(issue2097QueryDocument);
                expect(result.ownerProtectedThing).toBe(true);
                expect(result.publicThing).toBe(true);
            }
        });
    });

    async function assertRequestAllowed(operation: DocumentNode, variables?: any) {
        try {
            const status = await adminClient.queryStatus(operation, variables);
            expect(status).toBe(200);
        } catch (e: any) {
            const errorCode = getErrorCode(e);
            if (!errorCode) {
                fail(`Unexpected failure: ${JSON.stringify(e)}`);
            } else {
                fail(`Operation should be allowed, got status ${getErrorCode(e)}`);
            }
        }
    }

    async function assertRequestForbidden(operation: DocumentNode, variables?: any) {
        try {
            const status = await adminClient.query(operation, variables);
            fail('Should have thrown');
        } catch (e: any) {
            expect(getErrorCode(e)).toBe('FORBIDDEN');
        }
    }

    function getErrorCode(err: any): string {
        return err.response.errors[0].extensions.code;
    }

    async function createAdministratorWithPermissions(
        code: string,
        permissions: Permission[],
    ): Promise<{ identifier: string; password: string }> {
        const roleResult = await adminClient.query(createRoleDocument, {
            input: {
                code,
                description: '',
                permissions,
            },
        });

        const role = roleResult.createRole;

        const identifier = `${code}@${Math.random().toString(16).substr(2, 8)}`;
        const password = 'test';

        await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: identifier,
                firstName: code,
                lastName: 'Admin',
                password,
                roleIds: [role.id],
            },
        });
        return {
            identifier,
            password,
        };
    }
});
