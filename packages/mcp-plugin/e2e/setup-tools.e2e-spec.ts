import { LanguageCode } from '@vendure/common/lib/generated-types';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import {
    ConfigService,
    DefaultEncryptionStrategy,
    mergeConfig,
    PaymentMethod,
    PaymentMethodHandler,
    SettingsStoreScopes,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { MCP_TOOL_TOGGLES_STORE_KEY } from '../src/constants';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { McpPlugin } from '../src/plugin';
import { McpPluginOptions } from '../src/types';

import { callTool, consentDigestOf, postMcp, withConsent } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { testServerInit } from './utils/test-server';

const TOKEN_SECRET = 'setup-tools-secret-00000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;
const SECRET_API_KEY = 'sk_test_never_in_a_tool_result';
const SETTINGS_KEY = 'e2eSetup.greeting';

/** A payment handler with a secret argument, which no tool result may ever reveal. */
const secretArgPaymentHandler = new PaymentMethodHandler({
    code: 'e2e-secret-handler',
    description: [{ languageCode: LanguageCode.en, value: 'Handler with a secret argument' }],
    args: {
        apiKey: { type: 'string', secret: true },
        mode: { type: 'string', defaultValue: 'test' },
    },
    createPayment: (ctx, order, amount) => ({ amount, state: 'Settled' }),
    settlePayment: () => ({ success: true }),
});

describe('MCP setup-entity admin tools', () => {
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        // One grant makes every call in this suite, more than the default per-minute limits allow.
        // Nothing here tests rate limiting.
        rateLimits: {
            oauthIp: false,
            perSession: { rpm: 1000 },
            perUser: { rpm: 1000 },
            perClient: { rpm: 1000 },
        },
        // Full capture, so a test can show that no secret config arg reaches the log.
        logging: { capture: 'full' },
    };
    const config = mergeConfig(testConfig(), {
        paymentOptions: { paymentMethodHandlers: [secretArgPaymentHandler] },
        // Core refuses to start with a secret config arg and no way to encrypt it at rest.
        systemOptions: {
            encryptionStrategy: new DefaultEncryptionStrategy({
                secret: 'setup-tools-encryption-key-000000',
            }),
        },
        settingsStoreFields: { e2eSetup: [{ name: 'greeting', scope: SettingsStoreScopes.global }] },
        plugins: [McpPlugin.init(options)],
    });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    let token: string;
    let europeZoneId: string;
    let defaultTaxCategoryId: string;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();
        const flow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: adminClient.getAuthToken(),
        });
        token = flow.access_token;

        const zones = await call('list_zones', { limit: 100 });
        europeZoneId = zones.items.find((zone: { name: string }) => zone.name === 'Europe').id;
        const categories = await call('list_tax_categories', {});
        defaultTaxCategoryId = categories.items[0].id;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function callRaw(name: string, args: Record<string, unknown>, bearer = token) {
        const response = await postMcp(baseUrl(), 'admin', callTool(name, args), { token: bearer });
        return response.body.result;
    }

    /** Calls a tool and returns its structured result, failing the test if the call failed. */
    async function call(name: string, args: Record<string, unknown>) {
        const result = await callRaw(name, args);
        if (result?.isError) {
            throw new Error(`${name} failed: ${JSON.stringify(result.content)}`);
        }
        return result.structuredContent;
    }

    async function callError(name: string, args: Record<string, unknown>): Promise<string> {
        const result = await callRaw(name, args);
        expect(result.isError, `${name} was expected to fail`).toBe(true);
        return result.content.map((part: { text: string }) => part.text).join('\n');
    }

    describe('zones and countries', () => {
        it('enables a disabled country by code', async () => {
            await adminClient.query(
                gql`
                    mutation ($input: CreateCountryInput!) {
                        createCountry(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        code: 'NZ',
                        enabled: false,
                        translations: [{ languageCode: LanguageCode.en, name: 'New Zealand' }],
                    },
                },
            );
            const before = await call('list_countries', { filter: { code: { eq: 'NZ' } } });
            expect(before.items).toEqual([expect.objectContaining({ code: 'NZ', enabled: false })]);

            const enabled = await call('enable_countries', { codes: ['nz', 'GB'] });
            expect(enabled.countries).toEqual([
                expect.objectContaining({ code: 'NZ', enabled: true }),
                expect.objectContaining({ code: 'GB', enabled: true }),
            ]);
        });

        it('refuses every unknown country code in one message', async () => {
            const message = await callError('enable_countries', { codes: ['GB', 'QQ', 'XX'] });
            expect(message).toContain('"QQ"');
            expect(message).toContain('"XX"');
        });

        it('lists countries sorted by code', async () => {
            const result = await call('list_countries', { limit: 100 });
            const codes = result.items.map((country: { code: string }) => country.code);
            expect(codes).toEqual([...codes].sort());
        });

        it('creates a zone with members and replaces them on update', async () => {
            const created = await call('create_zone', {
                input: { name: 'Pacific', memberCountryCodes: ['AU', 'NZ'] },
            });
            expect(created.zone).toMatchObject({ id: expect.anything(), name: 'Pacific' });
            expect([...created.zone.memberCountryCodes].sort()).toEqual(['AU', 'NZ']);

            const updated = await call('update_zone', {
                id: created.zone.id,
                input: { name: 'Pacific Rim', memberCountryCodes: ['NZ', 'US'] },
            });
            expect(updated.zone.name).toBe('Pacific Rim');
            expect([...updated.zone.memberCountryCodes].sort()).toEqual(['NZ', 'US']);

            const listed = await call('list_zones', { limit: 100 });
            expect(listed.items).toContainEqual(updated.zone);
        });
    });

    describe('tax categories and tax rates', () => {
        it('creates and updates a tax category', async () => {
            const created = await call('create_tax_category', { input: { name: 'Books' } });
            expect(created.taxCategory).toEqual({ id: expect.anything(), name: 'Books', isDefault: false });
            const updated = await call('update_tax_category', {
                id: created.taxCategory.id,
                input: { name: 'Printed books' },
            });
            expect(updated.taxCategory.name).toBe('Printed books');
        });

        it('creates a zone rate and a country rate, then moves a rate to another target', async () => {
            const zoneRate = await call('create_tax_rate', {
                input: {
                    name: 'Europe standard',
                    value: 19,
                    taxCategoryId: defaultTaxCategoryId,
                    target: { zoneId: europeZoneId },
                },
            });
            expect(zoneRate.taxRate).toMatchObject({
                name: 'Europe standard',
                value: 19,
                enabled: true,
                taxCategory: { id: defaultTaxCategoryId },
                target: { zoneId: europeZoneId, zoneName: 'Europe' },
            });

            const countryRate = await call('create_tax_rate', {
                input: {
                    name: 'Austria standard',
                    value: 20,
                    taxCategoryId: defaultTaxCategoryId,
                    target: { countryCode: 'AT' },
                },
            });
            expect(countryRate.taxRate.target).toEqual({ countryCode: 'AT' });

            const moved = await call('update_tax_rate', {
                id: zoneRate.taxRate.id,
                input: { value: 21, target: { countryCode: 'GB' } },
            });
            expect(moved.taxRate).toMatchObject({ value: 21, target: { countryCode: 'GB' } });

            const listed = await call('list_tax_rates', { limit: 100 });
            expect(listed.items).toContainEqual(moved.taxRate);
            expect(listed.items).toContainEqual(countryRate.taxRate);
        });

        it('refuses a tax rate for an unknown country', async () => {
            const message = await callError('create_tax_rate', {
                input: {
                    name: 'Nowhere',
                    value: 5,
                    taxCategoryId: defaultTaxCategoryId,
                    target: { countryCode: 'QQ' },
                },
            });
            expect(message).toContain('"QQ"');
        });
    });

    describe('shipping methods', () => {
        it('lists the shipping checkers, calculators and fulfillment handlers with their args', async () => {
            const shippingOptions = await call('list_shipping_options', {});
            expect(shippingOptions.calculators.map((c: { code: string }) => c.code)).toContain(
                'default-shipping-calculator',
            );
            expect(shippingOptions.eligibilityCheckers.map((c: { code: string }) => c.code)).toContain(
                'default-shipping-eligibility-checker',
            );
            expect(shippingOptions.fulfillmentHandlers.map((h: { code: string }) => h.code)).toContain(
                'manual-fulfillment',
            );
            const calculator = shippingOptions.calculators.find(
                (c: { code: string }) => c.code === 'default-shipping-calculator',
            );
            expect(calculator.args.map((arg: { name: string }) => arg.name)).toContain('rate');
        });

        it('creates a shipping method with args and updates its calculator', async () => {
            const created = await call('create_shipping_method', {
                input: {
                    code: 'mcp-courier',
                    fulfillmentHandler: 'manual-fulfillment',
                    checker: { code: 'default-shipping-eligibility-checker', args: { orderMinimum: 0 } },
                    calculator: {
                        code: 'default-shipping-calculator',
                        args: { rate: 750, includesTax: 'auto', taxRate: 0 },
                    },
                    translations: [{ languageCode: 'en', name: 'MCP Courier' }],
                },
            });
            expect(created.shippingMethod).toMatchObject({
                code: 'mcp-courier',
                name: 'MCP Courier',
                fulfillmentHandlerCode: 'manual-fulfillment',
                calculator: {
                    code: 'default-shipping-calculator',
                    args: { rate: 750, includesTax: 'auto', taxRate: 0 },
                },
            });

            const updated = await call('update_shipping_method', {
                id: created.shippingMethod.id,
                input: {
                    calculator: {
                        code: 'default-shipping-calculator',
                        args: { rate: 900, includesTax: 'auto', taxRate: 0 },
                    },
                },
            });
            expect(updated.shippingMethod.calculator.args.rate).toBe(900);
            expect(updated.shippingMethod.name).toBe('MCP Courier');

            const listed = await call('list_shipping_methods', { limit: 100 });
            expect(listed.items.map((m: { code: string }) => m.code)).toContain('mcp-courier');
        });

        it('reports an unknown calculator code as a failed call', async () => {
            const message = await callError('create_shipping_method', {
                input: {
                    code: 'mcp-broken',
                    fulfillmentHandler: 'manual-fulfillment',
                    checker: { code: 'default-shipping-eligibility-checker', args: { orderMinimum: 0 } },
                    calculator: { code: 'no-such-calculator' },
                    translations: [{ languageCode: 'en', name: 'Broken' }],
                },
            });
            expect(message).toContain('no-such-calculator');
        });
    });

    describe('payment methods', () => {
        it('lists the payment handlers with their args', async () => {
            const paymentOptions = await call('list_payment_options', {});
            const handler = paymentOptions.handlers.find(
                (h: { code: string }) => h.code === 'e2e-secret-handler',
            );
            expect(handler.args.map((arg: { name: string }) => arg.name)).toEqual(['apiKey', 'mode']);
        });

        it('creates a payment method and never returns its secret argument', async () => {
            const created = await callRaw('create_payment_method', {
                input: {
                    code: 'mcp-card',
                    handler: { code: 'e2e-secret-handler', args: { apiKey: SECRET_API_KEY, mode: 'live' } },
                    translations: [{ languageCode: 'en', name: 'Card' }],
                },
            });
            expect(created.isError).toBeUndefined();
            expect(JSON.stringify(created)).not.toContain(SECRET_API_KEY);
            const method = created.structuredContent.paymentMethod;
            expect(method).toMatchObject({
                code: 'mcp-card',
                name: 'Card',
                enabled: true,
                checker: null,
                handler: {
                    code: 'e2e-secret-handler',
                    args: { apiKey: REDACTED_SECRET_PLACEHOLDER, mode: 'live' },
                },
            });

            const listed = await callRaw('list_payment_methods', { limit: 100 });
            expect(JSON.stringify(listed)).not.toContain(SECRET_API_KEY);

            // Sending the placeholder back keeps the stored secret, so an agent can change other args.
            const updated = await call('update_payment_method', {
                id: method.id,
                input: {
                    enabled: false,
                    handler: {
                        code: 'e2e-secret-handler',
                        args: { apiKey: REDACTED_SECRET_PLACEHOLDER, mode: 'test' },
                    },
                },
            });
            expect(updated.paymentMethod).toMatchObject({
                enabled: false,
                handler: { args: { apiKey: REDACTED_SECRET_PLACEHOLDER, mode: 'test' } },
            });
            expect(await storedApiKey('mcp-card')).toBe(SECRET_API_KEY);

            // Leaving the secret out keeps it too, rather than clearing it.
            await call('update_payment_method', {
                id: method.id,
                input: { handler: { code: 'e2e-secret-handler', args: { mode: 'live' } } },
            });
            expect(await storedApiKey('mcp-card')).toBe(SECRET_API_KEY);
        });

        it('never writes the secret argument to the tool-call log', async () => {
            const logs = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(McpToolCallLog)
                .find();
            const paymentLogs = logs.filter(log => log.toolName.endsWith('_payment_method'));
            // One create and two updates.
            expect(paymentLogs.length).toBe(3);
            expect(JSON.stringify(paymentLogs)).not.toContain(SECRET_API_KEY);
            const created = paymentLogs.find(log => log.toolName === 'create_payment_method');
            expect(created?.input).toMatchObject({
                input: { handler: { args: { apiKey: REDACTED_SECRET_PLACEHOLDER } } },
            });
        });
    });

    describe('delete tools', () => {
        /** Calls a delete tool, checks that its preview names the target, then confirms with the digest. */
        async function deleteWithConsent(name: string, args: Record<string, unknown>, previewText: string) {
            const message = callTool(name, args);
            const preview = await postMcp(baseUrl(), 'admin', message, { token });
            const content = preview.body.result.structuredContent;
            expect(content.status).toBe('incomplete');
            expect(content.preview).toEqual(expect.stringContaining(previewText));
            const digest = consentDigestOf(preview);
            expect(digest).toEqual(expect.any(String));
            const confirmed = await postMcp(baseUrl(), 'admin', withConsent(message, digest as string), {
                token,
            });
            return confirmed.body.result;
        }

        it('refuses confirm: true, and deletes only with the digest of the preview', async () => {
            const { zone } = await call('create_zone', {
                input: { name: 'Doomed', memberCountryCodes: ['CN'] },
            });
            const withTrue = await callRaw('delete_zone', { id: zone.id, confirm: true });
            expect(withTrue.isError ?? withTrue.structuredContent?.status === 'incomplete').toBeTruthy();

            const result = await deleteWithConsent('delete_zone', { id: zone.id }, 'Delete zone "Doomed"');
            expect(result.isError).toBeUndefined();
            expect(result.structuredContent).toEqual({ result: 'DELETED', message: null });
            const listed = await call('list_zones', { limit: 100 });
            expect(listed.items.map((z: { id: string }) => z.id)).not.toContain(zone.id);
        });

        it('reports a zone that is still in use as a failed call', async () => {
            const result = await deleteWithConsent(
                'delete_zone',
                { id: europeZoneId },
                'Delete zone "Europe"',
            );
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('used');
        });

        it('deletes a tax rate, a tax category, a shipping method and a payment method', async () => {
            const { taxCategory } = await call('create_tax_category', { input: { name: 'Temporary' } });
            const { taxRate } = await call('create_tax_rate', {
                input: {
                    name: 'Temporary rate',
                    value: 5,
                    taxCategoryId: taxCategory.id,
                    target: { countryCode: 'CA' },
                },
            });
            expect(
                (await deleteWithConsent('delete_tax_rate', { id: taxRate.id }, '"Temporary rate"')).isError,
            ).toBeUndefined();
            expect(
                (await deleteWithConsent('delete_tax_category', { id: taxCategory.id }, '"Temporary"'))
                    .isError,
            ).toBeUndefined();

            const { shippingMethod } = await call('create_shipping_method', {
                input: {
                    code: 'mcp-temporary',
                    fulfillmentHandler: 'manual-fulfillment',
                    checker: { code: 'default-shipping-eligibility-checker', args: { orderMinimum: 0 } },
                    calculator: {
                        code: 'default-shipping-calculator',
                        args: { rate: 1, includesTax: 'auto', taxRate: 0 },
                    },
                    translations: [{ languageCode: 'en', name: 'Temporary shipping' }],
                },
            });
            expect(
                (
                    await deleteWithConsent(
                        'delete_shipping_method',
                        { id: shippingMethod.id },
                        'mcp-temporary',
                    )
                ).isError,
            ).toBeUndefined();
            const shipping = await call('list_shipping_methods', { limit: 100 });
            expect(shipping.items.map((m: { code: string }) => m.code)).not.toContain('mcp-temporary');

            const { paymentMethod } = await call('create_payment_method', {
                input: {
                    code: 'mcp-temporary-payment',
                    handler: { code: 'e2e-secret-handler', args: { mode: 'test' } },
                    translations: [{ languageCode: 'en', name: 'Temporary payment' }],
                },
            });
            expect(
                (
                    await deleteWithConsent(
                        'delete_payment_method',
                        { id: paymentMethod.id },
                        'mcp-temporary-payment',
                    )
                ).isError,
            ).toBeUndefined();
        });

        it('deletes a stock location, moving its stock, and a role', async () => {
            const { stockLocation } = await call('create_stock_location', {
                input: { name: 'Temporary depot' },
            });
            const locations = await call('list_stock_locations', { limit: 100 });
            const other = locations.items.find((l: { id: string }) => l.id !== stockLocation.id);
            const result = await deleteWithConsent(
                'delete_stock_location',
                { id: stockLocation.id, transferToLocationId: other.id },
                `moves to location ${String(other.id)}`,
            );
            expect(result.isError).toBeUndefined();

            const { role } = await call('create_role', {
                input: { code: 'mcp-temporary', description: 'Temporary', permissions: ['ReadCatalog'] },
            });
            expect(
                (await deleteWithConsent('delete_role', { id: role.id }, '"mcp-temporary"')).isError,
            ).toBeUndefined();
        });

        it('deletes a channel', async () => {
            const { channel } = await call('create_channel', {
                input: {
                    code: 'mcp-temporary-channel',
                    token: 'mcp-temporary-channel-token',
                    defaultLanguageCode: 'en',
                    defaultCurrencyCode: 'USD',
                    pricesIncludeTax: false,
                    defaultTaxZoneId: europeZoneId,
                    defaultShippingZoneId: europeZoneId,
                },
            });
            const result = await deleteWithConsent(
                'delete_channel',
                { id: channel.id },
                'Delete channel "mcp-temporary-channel"',
            );
            expect(result.isError).toBeUndefined();
            expect((await call('get_channel', { id: channel.id })).channel).toBeNull();
        });
    });

    /** The stored value of the payment method's secret `apiKey` arg, decrypted. */
    async function storedApiKey(code: string): Promise<string | undefined> {
        const method = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(PaymentMethod)
            .findOne({ where: { code } });
        const value = method?.handler.args.find(arg => arg.name === 'apiKey')?.value;
        // mergeConfig copies the strategy, so the initialised one is read from the running server.
        const strategy = server.app.get(ConfigService).systemOptions.encryptionStrategy;
        return value && strategy ? strategy.decrypt(value) : undefined;
    }

    describe('stock locations', () => {
        it('creates, updates and lists a stock location', async () => {
            const created = await call('create_stock_location', {
                input: { name: 'North warehouse', description: 'Overflow stock' },
            });
            expect(created.stockLocation).toEqual({
                id: expect.anything(),
                name: 'North warehouse',
                description: 'Overflow stock',
            });
            const updated = await call('update_stock_location', {
                id: created.stockLocation.id,
                input: { name: 'North depot' },
            });
            expect(updated.stockLocation).toMatchObject({
                name: 'North depot',
                description: 'Overflow stock',
            });
            const listed = await call('list_stock_locations', { limit: 100 });
            expect(listed.items).toContainEqual(updated.stockLocation);
        });
    });

    describe('roles', () => {
        it('creates a role, replaces its permissions and lists it', async () => {
            const created = await call('create_role', {
                input: { code: 'mcp-catalog', description: 'Catalog editing', permissions: ['ReadCatalog'] },
            });
            expect(created.role).toMatchObject({ code: 'mcp-catalog' });
            expect([...created.role.permissions].sort()).toEqual(['Authenticated', 'ReadCatalog']);

            const updated = await call('update_role', {
                id: created.role.id,
                input: { permissions: ['ReadCatalog', 'UpdateCatalog'] },
            });
            expect([...updated.role.permissions].sort()).toEqual([
                'Authenticated',
                'ReadCatalog',
                'UpdateCatalog',
            ]);

            // The list replaces the old one, so a permission left out is removed.
            const narrowed = await call('update_role', {
                id: created.role.id,
                input: { permissions: ['UpdateCatalog'] },
            });
            expect([...narrowed.role.permissions].sort()).toEqual(['Authenticated', 'UpdateCatalog']);

            const listed = await call('list_roles', { limit: 100 });
            expect(listed.items.map((role: { code: string }) => role.code)).toContain('mcp-catalog');
        });

        it('refuses an unknown permission name', async () => {
            const message = await callError('create_role', {
                input: { code: 'mcp-bad', description: 'Bad', permissions: ['NotAPermission'] },
            });
            expect(message).toContain('NotAPermission');
        });
    });

    describe('settings', () => {
        it('writes and reads a settings-store value', async () => {
            const written = await call('set_setting', { key: SETTINGS_KEY, value: { text: 'hello' } });
            expect(written).toEqual({ key: SETTINGS_KEY, value: { text: 'hello' } });
            const read = await call('get_setting', { key: SETTINGS_KEY });
            expect(read).toEqual({ key: SETTINGS_KEY, value: { text: 'hello' } });
        });

        it('refuses to write the mcp namespace', async () => {
            const message = await callError('set_setting', { key: MCP_TOOL_TOGGLES_STORE_KEY, value: {} });
            expect(message).toContain('"mcp" namespace');
        });

        it('refuses an unknown key', async () => {
            const message = await callError('get_setting', { key: 'e2eSetup.missing' });
            expect(message).toContain('e2eSetup.missing');
        });
    });

    describe('channels', () => {
        it('creates a channel, reads it back and updates its currencies', async () => {
            const created = await call('create_channel', {
                input: {
                    code: 'mcp-nz',
                    token: 'mcp-nz-token',
                    defaultLanguageCode: 'en',
                    defaultCurrencyCode: 'USD',
                    pricesIncludeTax: true,
                    defaultTaxZoneId: europeZoneId,
                    defaultShippingZoneId: europeZoneId,
                },
            });
            expect(created.channel).toMatchObject({
                code: 'mcp-nz',
                token: 'mcp-nz-token',
                defaultCurrencyCode: 'USD',
                pricesIncludeTax: true,
                defaultTaxZone: { id: europeZoneId, name: 'Europe' },
                defaultShippingZone: { id: europeZoneId, name: 'Europe' },
            });

            const read = await call('get_channel', { id: created.channel.id });
            expect(read.channel).toEqual(created.channel);

            const updated = await call('update_channel', {
                id: created.channel.id,
                input: { availableCurrencyCodes: ['USD', 'EUR'], pricesIncludeTax: false },
            });
            expect(updated.channel).toMatchObject({ pricesIncludeTax: false });
            expect([...updated.channel.availableCurrencyCodes].sort()).toEqual(['EUR', 'USD']);
        });

        it('refuses currencies that leave out the default currency', async () => {
            const channels = await call('list_channels', {});
            const channel = channels.items.find((c: { code: string }) => c.code === 'mcp-nz');
            const result = await callRaw('update_channel', {
                id: channel.id,
                input: { availableCurrencyCodes: ['EUR'] },
            });
            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('defaultCurrencyCode');
        });

        it('reports an unknown channel as null', async () => {
            const read = await call('get_channel', { id: '99999' });
            expect(read.channel).toBeNull();
        });
    });
});
