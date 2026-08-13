import { Permission } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import {
    CollectionFilter,
    DefaultEncryptionStrategy,
    defaultCollectionFilters,
    LanguageCode,
    mergeConfig,
    PaymentMethod,
    PaymentMethodHandler,
    RequestContext,
    SecretAccessInput,
    SecretAccessStrategy,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createAdministratorDocument,
    createCollectionDocument,
    createRoleDocument,
    getCollectionDocument,
    updateCollectionDocument,
} from './graphql/shared-definitions';
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

// A CollectionFilter is a different `ConfigurableOperationDef` type on a different entity than a
// PaymentMethodHandler. It has no bespoke secret-handling code of its own — it exercises the same
// central encryption, redaction and preservation as every other operation type.
const secretCollectionFilter = new CollectionFilter({
    code: 'secret-test-filter',
    description: [{ languageCode: LanguageCode.en, value: 'Secret test filter' }],
    args: {
        apiKey: { type: 'string', secret: true },
        label: { type: 'string' },
    },
    apply: qb => qb,
});

const PLAINTEXT_KEY = 'sk_live_supersecret';
const FILTER_PLAINTEXT_KEY = 'ck_live_collectionsecret';

// Captures the input passed to the strategy so a test can assert the derived owner (entityType/field)
// and code for a config arg, while preserving the default permission-based reveal decision.
let capturedSecretAccessInput: SecretAccessInput | undefined;
class CapturingSecretAccessStrategy implements SecretAccessStrategy {
    canAccessSecret(ctx: RequestContext, input: SecretAccessInput): boolean {
        capturedSecretAccessInput = input;
        return ctx.userHasPermissions([Permission.ReadSecret]);
    }
}

// #2648 — `secret` config arg values must be encrypted at rest and never returned in plaintext
// to a caller without the ReadSecret permission.
describe('secret config args', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            paymentOptions: {
                paymentMethodHandlers: [secretPaymentHandler],
            },
            catalogOptions: {
                collectionFilters: [...defaultCollectionFilters, secretCollectionFilter],
            },
            systemOptions: {
                encryptionStrategy: new DefaultEncryptionStrategy({ secret: 'test-encryption-key' }),
                secretAccessStrategy: new CapturingSecretAccessStrategy(),
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
                    Permission.ReadCollection,
                    Permission.CreateCollection,
                    Permission.UpdateCollection,
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

    it('provides the code and derived owner (entityType/field) to the strategy for a config arg', async () => {
        capturedSecretAccessInput = undefined;
        await adminClient.asSuperAdmin();
        await adminClient.query(getPaymentMethodDocument, { id: paymentMethodId });
        const captured = capturedSecretAccessInput as SecretAccessInput | undefined;
        expect(captured?.kind).toBe('configArg');
        if (captured?.kind === 'configArg') {
            expect(captured.code).toBe(secretPaymentHandler.code);
            expect(captured.argName).toBe('apiKey');
            expect(captured.entityType).toBe('PaymentMethod');
            expect(captured.field).toBe('handler');
        }
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

    // A secret arg is redacted based on its definition, not on whether the stored value happens to
    // be encrypted. A value stored as plaintext (e.g. written before the field was marked secret)
    // must not leak to a caller without ReadSecret.
    it('redacts a secret arg stored as legacy plaintext', async () => {
        await adminClient.asSuperAdmin();
        const { createPaymentMethod } = await adminClient.query(createPaymentMethodDocument, {
            input: {
                code: 'legacy-plaintext-pm',
                enabled: true,
                handler: await makeHandlerInput('placeholder-will-be-overwritten'),
                translations: [{ languageCode: LanguageCode.en, name: 'Legacy PM', description: '' }],
            },
        });
        const id = createPaymentMethod.id;

        // Simulate legacy/plaintext data by writing an un-encrypted value directly into the stored
        // handler args, bypassing the service-layer encryption.
        const connection = server.app.get(TransactionalConnection);
        const repo = connection.rawConnection.getRepository(PaymentMethod);
        const pm = await repo.findOne({ where: { code: 'legacy-plaintext-pm' } });
        const storedApiKey = pm!.handler.args.find(a => a.name === 'apiKey');
        storedApiKey!.value = 'pk_legacy_plaintext';
        await repo.save(pm!);

        // A non-ReadSecret admin must receive the placeholder, not the plaintext.
        await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
        const { paymentMethod: asManager } = await adminClient.query(getPaymentMethodDocument, { id });
        expect(asManager?.handler.args.find(a => a.name === 'apiKey')?.value).toBe(
            REDACTED_SECRET_PLACEHOLDER,
        );

        // A ReadSecret holder sees the (plaintext) value as-is.
        await adminClient.asSuperAdmin();
        const { paymentMethod: asAdmin } = await adminClient.query(getPaymentMethodDocument, { id });
        expect(asAdmin?.handler.args.find(a => a.name === 'apiKey')?.value).toBe('pk_legacy_plaintext');
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

    // The systemic redaction/preservation must work for an operation type with no bespoke wiring of
    // its own — CollectionFilter here. Before this was centralised, `Collection.filters` returned the
    // raw ciphertext to any ReadCollection holder.
    describe('any configurable operation type (collection filter)', () => {
        let collectionId: string;

        function makeFilterInput(apiKey: string, label = 'coll') {
            return {
                code: secretCollectionFilter.code,
                arguments: [
                    { name: 'apiKey', value: apiKey },
                    { name: 'label', value: label },
                ],
            };
        }

        it('a ReadSecret holder sees the plaintext filter arg on create', async () => {
            await adminClient.asSuperAdmin();
            const { createCollection } = await adminClient.query(createCollectionDocument, {
                input: {
                    filters: [makeFilterInput(FILTER_PLAINTEXT_KEY)],
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Secret Collection',
                            description: '',
                            slug: 'secret-collection',
                        },
                    ],
                },
            });
            collectionId = createCollection.id;
            const apiKey = createCollection.filters[0].args.find(a => a.name === 'apiKey');
            expect(apiKey?.value).toBe(FILTER_PLAINTEXT_KEY);
        });

        it('a non-ReadSecret admin gets the placeholder, but non-secret args are visible', async () => {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            const { collection } = await adminClient.query(getCollectionDocument, { id: collectionId });
            const apiKey = collection?.filters[0].args.find(a => a.name === 'apiKey');
            const label = collection?.filters[0].args.find(a => a.name === 'label');
            expect(apiKey?.value).toBe(REDACTED_SECRET_PLACEHOLDER);
            expect(label?.value).toBe('coll');
        });

        it('submitting the placeholder on update preserves the stored secret', async () => {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            await adminClient.query(updateCollectionDocument, {
                input: {
                    id: collectionId,
                    filters: [makeFilterInput(REDACTED_SECRET_PLACEHOLDER, 'coll-renamed')],
                },
            });
            await adminClient.asSuperAdmin();
            const { collection } = await adminClient.query(getCollectionDocument, { id: collectionId });
            const apiKey = collection?.filters[0].args.find(a => a.name === 'apiKey');
            const label = collection?.filters[0].args.find(a => a.name === 'label');
            expect(apiKey?.value).toBe(FILTER_PLAINTEXT_KEY);
            expect(label?.value).toBe('coll-renamed');
        });

        // Two filters share the same code, so preserving by code alone would give both the first
        // filter's secret. Each must preserve its own.
        it('preserves each secret independently for duplicate operations of the same code', async () => {
            await adminClient.asSuperAdmin();
            const { createCollection } = await adminClient.query(createCollectionDocument, {
                input: {
                    filters: [makeFilterInput('ck_first', 'a'), makeFilterInput('ck_second', 'b')],
                    translations: [
                        {
                            languageCode: LanguageCode.en,
                            name: 'Dup Filter Collection',
                            description: '',
                            slug: 'dup-filter-collection',
                        },
                    ],
                },
            });
            const dupId = createCollection.id;
            expect(createCollection.filters[0].args.find(a => a.name === 'apiKey')?.value).toBe('ck_first');
            expect(createCollection.filters[1].args.find(a => a.name === 'apiKey')?.value).toBe('ck_second');

            await adminClient.query(updateCollectionDocument, {
                input: {
                    id: dupId,
                    filters: [
                        makeFilterInput(REDACTED_SECRET_PLACEHOLDER, 'a2'),
                        makeFilterInput(REDACTED_SECRET_PLACEHOLDER, 'b2'),
                    ],
                },
            });
            const { collection } = await adminClient.query(getCollectionDocument, { id: dupId });
            expect(collection?.filters[0].args.find(a => a.name === 'apiKey')?.value).toBe('ck_first');
            expect(collection?.filters[1].args.find(a => a.name === 'apiKey')?.value).toBe('ck_second');
            expect(collection?.filters[0].args.find(a => a.name === 'label')?.value).toBe('a2');
            expect(collection?.filters[1].args.find(a => a.name === 'label')?.value).toBe('b2');
        });
    });
});
