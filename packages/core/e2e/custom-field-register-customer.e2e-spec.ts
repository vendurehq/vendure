import { CustomFields, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { graphql as graphqlShop } from './graphql/graphql-shop';

/**
 * These tests need their own config because `custom-fields.e2e-spec.ts` relies on Customer
 * having no writable custom fields, and `RegisterCustomerInput` only gains a `customFields`
 * field when Customer has at least one which is public and writable.
 */
const customConfig = mergeConfig(testConfig(), {
    customFields: {
        Customer: [
            {
                name: 'validateOnRegister',
                type: 'string',
                nullable: true,
                validate: value => {
                    if (value !== 'valid') {
                        return `The value ['${value as string}'] is not valid`;
                    }
                },
            },
            {
                name: 'defaultOnRegister',
                type: 'string',
                nullable: true,
                defaultValue: 'the-default',
            },
        ],
    } as CustomFields,
});

const registerDocument = graphqlShop(`
    mutation RegisterWithCustomFields($emailAddress: String!, $value: String) {
        registerCustomerAccount(
            input: { emailAddress: $emailAddress, customFields: { validateOnRegister: $value } }
        ) {
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const registerWithNullDefaultDocument = graphqlShop(`
    mutation RegisterWithNullDefault($emailAddress: String!) {
        registerCustomerAccount(
            input: { emailAddress: $emailAddress, customFields: { defaultOnRegister: null } }
        ) {
            ... on Success {
                success
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

const getCustomerByEmailDocument = graphql(`
    query GetCustomerByEmail($emailAddress: String!) {
        customers(options: { filter: { emailAddress: { eq: $emailAddress } } }) {
            totalItems
            items {
                id
                emailAddress
                customFields {
                    validateOnRegister
                    defaultOnRegister
                }
            }
        }
    }
`);

describe('Custom fields on RegisterCustomerInput', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(customConfig);

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

    it('rejects an invalid value and creates no account', async () => {
        await expect(
            shopClient.query(registerDocument, {
                emailAddress: 'register-validation-invalid@test.com',
                value: 'nope',
            }),
        ).rejects.toThrow("The value ['nope'] is not valid");

        const { customers } = await adminClient.query(getCustomerByEmailDocument, {
            emailAddress: 'register-validation-invalid@test.com',
        });

        expect(customers.totalItems).toBe(0);
    });

    it('persists the custom field when the value is valid', async () => {
        const { registerCustomerAccount } = await shopClient.query(registerDocument, {
            emailAddress: 'register-validation-valid@test.com',
            value: 'valid',
        });

        expect(registerCustomerAccount).toEqual({ success: true });

        const { customers } = await adminClient.query(getCustomerByEmailDocument, {
            emailAddress: 'register-validation-valid@test.com',
        });

        expect(customers.totalItems).toBe(1);
        expect(customers.items[0].customFields.validateOnRegister).toBe('valid');
    });

    it('applies default values to custom fields explicitly set to null', async () => {
        const { registerCustomerAccount } = await shopClient.query(registerWithNullDefaultDocument, {
            emailAddress: 'register-default@test.com',
        });

        expect(registerCustomerAccount).toEqual({ success: true });

        const { customers } = await adminClient.query(getCustomerByEmailDocument, {
            emailAddress: 'register-default@test.com',
        });

        expect(customers.totalItems).toBe(1);
        expect(customers.items[0].customFields.defaultOnRegister).toBe('the-default');
    });
});
