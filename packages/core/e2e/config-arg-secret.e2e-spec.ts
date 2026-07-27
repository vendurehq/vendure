import { Permission } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import {
    DefaultEncryptionStrategy,
    LanguageCode,
    mergeConfig,
    PaymentMethod,
    PaymentMethodHandler,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { createAdministratorDocument, createRoleDocument } from './graphql/shared-definitions';
import {
    createPaymentMethodDocument,
    getPaymentMethodDocument,
    updatePaymentMethodDocument,
} from './payment-method.e2e-spec';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const secretPaymentHandler = new PaymentMethodHandler({
    code: 'secret-test-handler',
    description: [{ languageCode: LanguageCode.en, value: 'Secret test handler' }],
    args: {
        apiKey: { type: 'string', secret: true },
        label: { type: 'string' },
    },
    createPayment: (ctx, order, amount) => ({ amount, state: 'Settled' as const, metadata: {} }),
    settlePayment: () => ({ success: true }),
});

const PLAINTEXT_KEY = 'sk_live_supersecret';

describe('secret config args (GHSA-j7pc)', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [secretPaymentHandler],
            },
            systemOptions: {
                encryptionStrategy: new DefaultEncryptionStrategy({ secret: 'test-encryption-key' }),
            },
        }),
    );

    const manager = { emailAddress: 'pm-manager@test.com', password: 'test-password' };
    let paymentMethodId: string;

    async function makeHandlerInput(apiKey: string, label = 'prod') {
        return {
            code: secretPaymentHandler.code,
            arguments: [
                { name: 'apiKey', value: apiKey },
                { name: 'label', value: label },
            ],
        };
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        // A manager who can manage payment methods but does NOT hold ReadSecret.
        const { createRole } = await adminClient.query(createRoleDocument, {
            input: {
                code: 'pm-manager',
                description: 'Payment method manager',
                permissions: [
                    Permission.ReadPaymentMethod,
                    Permission.CreatePaymentMethod,
                    Permission.UpdatePaymentMethod,
                ],
                channelIds: ['T_1'],
            },
        });
        await adminClient.query(createAdministratorDocument, {
            input: {
                emailAddress: manager.emailAddress,
                firstName: 'PM',
                lastName: 'Manager',
                password: manager.password,
                roleIds: [createRole.id],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('a ReadSecret holder gets the plaintext value round-tripped on create', async () => {
        await adminClient.asSuperAdmin();
        const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
            input: {
                code: 'secret-pm',
                enabled: true,
                handler: await makeHandlerInput(PLAINTEXT_KEY),
                translations: [{ languageCode: LanguageCode.en, name: 'Secret PM', description: '' }],
            },
        });
        paymentMethodId = createPaymentMethod.id;
        const apiKey = createPaymentMethod.handler.args.find(a => a.name === 'apiKey');
        expect(apiKey?.value).toBe(PLAINTEXT_KEY);
    });

    it('stores the secret arg encrypted at rest', async () => {
        const connection = server.app.get(TransactionalConnection);
        const stored = await connection.rawConnection
            .getRepository(PaymentMethod)
            .findOne({ where: { code: 'secret-pm' } });
        const apiKey = stored?.handler.args.find(a => a.name === 'apiKey');
        expect(apiKey?.value).toMatch(/^enc:v1:/);
        expect(apiKey?.value).not.toContain(PLAINTEXT_KEY);
    });

    it('a non-ReadSecret admin gets the redaction placeholder, but non-secret args are visible', async () => {
        await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        const { paymentMethod } = await adminClient.query(getPaymentMethodDocument, { id: paymentMethodId });
        const apiKey = paymentMethod?.handler.args.find(a => a.name === 'apiKey');
        const label = paymentMethod?.handler.args.find(a => a.name === 'label');
        expect(apiKey?.value).toBe(REDACTED_SECRET_PLACEHOLDER);
        expect(label?.value).toBe('prod');
    });

    it('submitting the placeholder on update preserves the stored secret', async () => {
        await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        await adminClient.query(updatePaymentMethodDocument, {
            input: {
                id: paymentMethodId,
                handler: await makeHandlerInput(REDACTED_SECRET_PLACEHOLDER, 'prod-renamed'),
            },
        });
        // The SuperAdmin (ReadSecret) should still see the original key.
        await adminClient.asSuperAdmin();
        const { paymentMethod } = await adminClient.query(getPaymentMethodDocument, { id: paymentMethodId });
        const apiKey = paymentMethod?.handler.args.find(a => a.name === 'apiKey');
        const label = paymentMethod?.handler.args.find(a => a.name === 'label');
        expect(apiKey?.value).toBe(PLAINTEXT_KEY);
        expect(label?.value).toBe('prod-renamed');
    });

    it('submitting a new value on update replaces the stored secret', async () => {
        await adminClient.asSuperAdmin();
        await adminClient.query(updatePaymentMethodDocument, {
            input: {
                id: paymentMethodId,
                handler: await makeHandlerInput('sk_live_rotated', 'prod-renamed'),
            },
        });
        const { paymentMethod } = await adminClient.query(getPaymentMethodDocument, { id: paymentMethodId });
        const apiKey = paymentMethod?.handler.args.find(a => a.name === 'apiKey');
        expect(apiKey?.value).toBe('sk_live_rotated');
    });

    it(
        'rejects the placeholder value on create',
        assertThrowsWithMessage(async () => {
            await adminClient.asSuperAdmin();
            await adminClient.query(createPaymentMethodDocument, {
                input: {
                    code: 'secret-pm-2',
                    enabled: true,
                    handler: await makeHandlerInput(REDACTED_SECRET_PLACEHOLDER),
                    translations: [{ languageCode: LanguageCode.en, name: 'Secret PM 2', description: '' }],
                },
            });
        }, 'A value must be provided for the secret argument "apiKey"'),
    );
});
