import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    AddressBasedTaxZoneStrategy,
    EventBus,
    Order,
    OrderLine,
    ShippingLine,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';

interface Finding {
    code: string;
    severity: 'ERROR' | 'WARNING';
    message: string;
    channelId: string | null;
    zoneId: string | null;
    countryCode: string | null;
    taxCategoryId: string | null;
    fixes: Array<{ path: string[]; input: any; description: string }>;
    dashboardUrl: string | null;
}

interface Report {
    ready: boolean;
    findings: Finding[];
}

const STORE_READINESS = gql`
    query StoreReadiness($channelIds: [ID!]) {
        storeReadiness(channelIds: $channelIds) {
            ready
            findings {
                code
                severity
                message
                channelId
                zoneId
                countryCode
                taxCategoryId
                fixes {
                    path
                    input
                    description
                }
                dashboardUrl
            }
        }
    }
`;

describe('storeReadiness', () => {
    const config = testConfig();
    config.paymentOptions.paymentMethodHandlers = [testSuccessfulPaymentMethod];
    // The tax zone follows the address, so a zone's own rates decide the tax of orders to its countries.
    config.taxOptions.taxZoneStrategy = new AddressBasedTaxZoneStrategy();
    const { server, adminClient } = createTestEnvironment(config);

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

    async function check(channelIds?: string[]): Promise<Report> {
        const result = await adminClient.query(STORE_READINESS, { channelIds });
        return result.storeReadiness;
    }

    function codes(report: Report): string[] {
        return report.findings.map(finding => finding.code);
    }

    it('reports a store without a payment method as not ready, with a fix', async () => {
        const report = await check();
        expect(report.ready).toBe(false);
        const finding = report.findings.find(f => f.code === 'store.channel.no-payment-method');
        const { activeChannel } = await adminClient.query(gql`
            query {
                activeChannel {
                    id
                }
            }
        `);
        expect(finding).toMatchObject({
            severity: 'ERROR',
            dashboardUrl: '/payment-methods',
            channelId: activeChannel.id,
        });
        expect(finding?.fixes.map(fix => fix.path[0])).toEqual([
            'admin_list_payment_options',
            'admin_create_payment_method',
        ]);
        expect(finding?.fixes[1].input.input.handler.code).toBe(testSuccessfulPaymentMethod.code);
    });

    it('warns about the default superadmin password without making the store not ready', async () => {
        const report = await check();
        expect(report.findings).toContainEqual(
            expect.objectContaining({ code: 'store.auth.default-superadmin-password', severity: 'WARNING' }),
        );
    });

    it('reports a seeded store with a payment method as ready', async () => {
        await adminClient.query(
            gql`
                mutation ($input: CreatePaymentMethodInput!) {
                    createPaymentMethod(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    code: 'test-payment',
                    enabled: true,
                    handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    translations: [{ languageCode: LanguageCode.en, name: 'Test payment' }],
                },
            },
        );
        const report = await check();
        expect(report.findings.filter(f => f.severity === 'ERROR')).toEqual([]);
        expect(report.ready).toBe(true);
    });

    it('writes no rows and publishes no events', async () => {
        const connection = server.app.get(TransactionalConnection);
        const count = () =>
            Promise.all(
                [Order, OrderLine, ShippingLine].map(entity =>
                    connection.rawConnection.getRepository(entity).count(),
                ),
            );
        const eventBus = server.app.get(EventBus);
        const publish = vi.spyOn(eventBus, 'publish');
        const before = await count();
        try {
            await check();
            expect(await count()).toEqual(before);
            expect(publish).not.toHaveBeenCalled();
        } finally {
            publish.mockRestore();
        }
    });

    it('reports a zone with no tax rate for the countries it covers', async () => {
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
                    enabled: true,
                    translations: [{ languageCode: LanguageCode.en, name: 'New Zealand' }],
                },
            },
        );
        const { countries } = await adminClient.query(gql`
            query {
                countries(options: { filter: { code: { eq: "NZ" } } }) {
                    items {
                        id
                    }
                }
            }
        `);
        const { createZone } = await adminClient.query(
            gql`
                mutation ($input: CreateZoneInput!) {
                    createZone(input: $input) {
                        id
                    }
                }
            `,
            { input: { name: 'Pacific', memberIds: [countries.items[0].id] } },
        );

        const report = await check();
        const missing = report.findings.filter(
            f => f.code === 'store.tax.no-rate' && f.zoneId === createZone.id,
        );
        // The fixture's variants all use one tax category.
        expect(missing).toHaveLength(1);
        expect(missing[0].message).toContain('orders to NZ');
        // A fix is an MCP tool call, so its IDs are the database IDs the tools take, not the encoded
        // IDs the e2e ID strategy gives the Admin API.
        const fixInput = missing[0].fixes[0].input.input;
        expect(missing[0].fixes[0].path).toEqual(['admin_create_tax_rate']);
        expect(`T_${String(fixInput.target.zoneId)}`).toBe(createZone.id);
        expect(`T_${String(fixInput.taxCategoryId)}`).toBe(missing[0].taxCategoryId);
        expect(report.ready).toBe(false);

        // A rate for the country alone is enough: the country rate applies inside the zone.
        await adminClient.query(
            gql`
                mutation ($input: CreateTaxRateInput!) {
                    createTaxRate(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    name: 'NZ rate',
                    value: 15,
                    enabled: true,
                    categoryId: missing[0].taxCategoryId,
                    regionId: countries.items[0].id,
                },
            },
        );
        const after = await check();
        expect(
            after.findings.some(
                f =>
                    f.code === 'store.tax.no-rate' &&
                    f.zoneId === createZone.id &&
                    f.taxCategoryId === missing[0].taxCategoryId,
            ),
        ).toBe(false);
    });

    it('reports a tax-inclusive channel whose default tax zone has no zone rate for a tax category', async () => {
        const { activeChannel } = await adminClient.query(gql`
            query {
                activeChannel {
                    id
                    defaultTaxZone {
                        id
                        members {
                            id
                        }
                    }
                }
            }
        `);
        const defaultTaxZone = activeChannel.defaultTaxZone;
        const { createTaxCategory } = await adminClient.query(
            gql`
                mutation ($input: CreateTaxCategoryInput!) {
                    createTaxCategory(input: $input) {
                        id
                    }
                }
            `,
            { input: { name: 'Inclusive test' } },
        );
        const { productVariants } = await adminClient.query(gql`
            query {
                productVariants(options: { take: 1 }) {
                    items {
                        id
                        taxCategory {
                            id
                        }
                    }
                }
            }
        `);
        const variant = productVariants.items[0];
        const UPDATE_VARIANT = gql`
            mutation ($input: [UpdateProductVariantInput!]!) {
                updateProductVariants(input: $input) {
                    id
                }
            }
        `;
        const UPDATE_CHANNEL = gql`
            mutation ($input: UpdateChannelInput!) {
                updateChannel(input: $input) {
                    ... on Channel {
                        id
                    }
                }
            }
        `;
        const CREATE_TAX_RATE = gql`
            mutation ($input: CreateTaxRateInput!) {
                createTaxRate(input: $input) {
                    id
                }
            }
        `;
        const inclusiveFindings = async () =>
            (await check()).findings.filter(
                f =>
                    f.code === 'store.tax.inclusive-rate-unknown' && f.taxCategoryId === createTaxCategory.id,
            );

        await adminClient.query(UPDATE_VARIANT, {
            input: [{ id: variant.id, taxCategoryId: createTaxCategory.id }],
        });
        try {
            // Prices that exclude tax need no rate on the default tax zone.
            expect(await inclusiveFindings()).toEqual([]);

            await adminClient.query(UPDATE_CHANNEL, {
                input: { id: activeChannel.id, pricesIncludeTax: true },
            });
            const report = await check();
            // The tax rate check leaves this zone to the tax-inclusive check, so the report has one
            // finding and one fix for it, not two zone rates to create.
            const forCategory = report.findings.filter(
                f => f.taxCategoryId === createTaxCategory.id && f.zoneId === defaultTaxZone.id,
            );
            expect(forCategory.map(f => f.code)).toEqual(['store.tax.inclusive-rate-unknown']);
            const [finding] = forCategory;
            expect(finding).toMatchObject({
                severity: 'ERROR',
                channelId: activeChannel.id,
                zoneId: defaultTaxZone.id,
                dashboardUrl: '/tax-rates',
            });
            expect(finding.message).toContain('"Inclusive test"');
            expect(finding.fixes[0].path).toEqual(['admin_create_tax_rate']);
            const fixInput = finding.fixes[0].input.input;
            expect(`T_${String(fixInput.target.zoneId)}`).toBe(defaultTaxZone.id);
            expect(`T_${String(fixInput.taxCategoryId)}`).toBe(createTaxCategory.id);

            // A country rate inside the default tax zone does not tell core which rate the price includes.
            await adminClient.query(CREATE_TAX_RATE, {
                input: {
                    name: 'Inclusive test country',
                    value: 20,
                    enabled: true,
                    categoryId: createTaxCategory.id,
                    regionId: defaultTaxZone.members[0].id,
                },
            });
            expect(await inclusiveFindings()).toHaveLength(1);

            await adminClient.query(CREATE_TAX_RATE, {
                input: {
                    name: 'Inclusive test zone',
                    value: 20,
                    enabled: true,
                    categoryId: createTaxCategory.id,
                    zoneId: defaultTaxZone.id,
                },
            });
            expect(await inclusiveFindings()).toEqual([]);
        } finally {
            await adminClient.query(UPDATE_CHANNEL, {
                input: { id: activeChannel.id, pricesIncludeTax: false },
            });
            await adminClient.query(UPDATE_VARIANT, {
                input: [{ id: variant.id, taxCategoryId: variant.taxCategory.id }],
            });
        }
    });

    it('reports a country that matches two zone rates as ambiguous', async () => {
        const { zones } = await adminClient.query(gql`
            query {
                zones {
                    items {
                        id
                        name
                        members {
                            id
                            code
                        }
                    }
                }
            }
        `);
        const europe = zones.items.find((zone: any) => zone.name === 'Europe');
        const austria = europe.members.find((member: any) => member.code === 'AT');
        const { createZone } = await adminClient.query(
            gql`
                mutation ($input: CreateZoneInput!) {
                    createZone(input: $input) {
                        id
                    }
                }
            `,
            { input: { name: 'DACH', memberIds: [austria.id] } },
        );
        const { taxCategories } = await adminClient.query(gql`
            query {
                taxCategories {
                    items {
                        id
                    }
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($input: CreateTaxRateInput!) {
                    createTaxRate(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    name: 'DACH standard',
                    value: 20,
                    enabled: true,
                    categoryId: taxCategories.items[0].id,
                    zoneId: createZone.id,
                },
            },
        );

        const report = await check();
        expect(report.findings).toContainEqual(
            expect.objectContaining({
                code: 'store.tax.ambiguous-zone-rates',
                severity: 'WARNING',
                countryCode: 'AT',
                taxCategoryId: taxCategories.items[0].id,
            }),
        );
    });

    it('reports a channel currency that has no variant prices', async () => {
        const { activeChannel } = await adminClient.query(gql`
            query {
                activeChannel {
                    id
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($input: UpdateChannelInput!) {
                    updateChannel(input: $input) {
                        ... on Channel {
                            id
                        }
                    }
                }
            `,
            {
                input: {
                    id: activeChannel.id,
                    availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.EUR],
                },
            },
        );
        try {
            const report = await check();
            const finding = report.findings.find(f => f.code === 'store.channel.missing-prices');
            expect(finding).toMatchObject({ severity: 'ERROR', channelId: activeChannel.id });
            expect(finding?.message).toContain('EUR');
        } finally {
            await adminClient.query(
                gql`
                    mutation ($input: UpdateChannelInput!) {
                        updateChannel(input: $input) {
                            ... on Channel {
                                id
                            }
                        }
                    }
                `,
                { input: { id: activeChannel.id, availableCurrencyCodes: [CurrencyCode.USD] } },
            );
        }
    });

    it('reports each zone for which no shipping method is eligible', async () => {
        const { shippingMethods } = await adminClient.query(gql`
            query {
                shippingMethods {
                    items {
                        id
                    }
                }
            }
        `);
        const setOrderMinimum = (orderMinimum: number) =>
            Promise.all(
                shippingMethods.items.map((method: { id: string }) =>
                    adminClient.query(
                        gql`
                            mutation ($input: UpdateShippingMethodInput!) {
                                updateShippingMethod(input: $input) {
                                    id
                                }
                            }
                        `,
                        {
                            input: {
                                id: method.id,
                                translations: [],
                                checker: {
                                    code: 'default-shipping-eligibility-checker',
                                    arguments: [{ name: 'orderMinimum', value: String(orderMinimum) }],
                                },
                            },
                        },
                    ),
                ),
            );
        const { zones } = await adminClient.query(gql`
            query {
                zones {
                    items {
                        id
                        members {
                            enabled
                            type
                        }
                    }
                }
            }
        `);
        // A zone counts when it has an enabled country, as in the check.
        const shippingZoneIds = zones.items
            .filter((z: { members: Array<{ enabled: boolean; type: string }> }) =>
                z.members.some(m => m.enabled && m.type === 'country'),
            )
            .map((z: { id: string }) => z.id)
            .sort();
        await setOrderMinimum(1_000_000_000);
        try {
            const report = await check();
            const ineligible = report.findings.filter(f => f.code === 'store.shipping.no-eligible-method');
            // One finding per zone the channel ships to.
            expect(ineligible.map(f => f.zoneId).sort()).toEqual(shippingZoneIds);
            expect(ineligible[0]).toMatchObject({ severity: 'ERROR', dashboardUrl: '/shipping-methods' });
            expect(ineligible[0].countryCode).toMatch(/^[A-Z]{2}$/);
        } finally {
            await setOrderMinimum(0);
        }
        const restored = await check();
        expect(codes(restored)).not.toContain('store.shipping.no-eligible-method');
    });

    it('checks only the channels asked for, and refuses an unknown one', async () => {
        const { zones } = await adminClient.query(gql`
            query {
                zones(options: { take: 1 }) {
                    items {
                        id
                    }
                }
            }
        `);
        const { createChannel } = await adminClient.query(
            gql`
                mutation ($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        ... on Channel {
                            id
                        }
                    }
                }
            `,
            {
                input: {
                    code: 'second',
                    token: 'second-token',
                    defaultLanguageCode: LanguageCode.en,
                    defaultCurrencyCode: CurrencyCode.USD,
                    pricesIncludeTax: false,
                    defaultTaxZoneId: zones.items[0].id,
                    defaultShippingZoneId: zones.items[0].id,
                },
            },
        );
        const report = await check([createChannel.id]);
        const channelIds = new Set(report.findings.filter(f => f.channelId != null).map(f => f.channelId));
        // The new channel has no payment method, so it has findings, and only it is checked.
        expect([...channelIds]).toEqual([createChannel.id]);
        expect(codes(report)).toContain('store.channel.no-payment-method');

        await expect(check(['T_99999'])).rejects.toThrow(/No Channel with the id "99999"/);
    });

    it('shows a channel administrator only their channel, and not the superadmin password', async () => {
        const { channels } = await adminClient.query(gql`
            query {
                channels {
                    items {
                        id
                        code
                        token
                    }
                }
            }
        `);
        const second = channels.items.find((c: { code: string }) => c.code === 'second');
        const defaultChannel = channels.items.find((c: { code: string }) => c.code !== 'second');
        const { createRole } = await adminClient.query(
            gql`
                mutation ($input: CreateRoleInput!) {
                    createRole(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    code: 'second-settings',
                    description: 'Second settings',
                    permissions: ['ReadSettings'],
                },
            },
        );
        await adminClient.query(
            gql`
                mutation ($input: CreateAdministratorInput!) {
                    createAdministrator(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    firstName: 'Second',
                    lastName: 'Admin',
                    emailAddress: 'second@example.test',
                    password: 'test',
                    roleAssignments: [{ roleId: createRole.id, channelId: second.id }],
                },
            },
        );
        await adminClient.asUserWithCredentials('second@example.test', 'test');
        adminClient.setChannelToken(second.token);
        try {
            const report = await check();
            const channelIds = new Set(
                report.findings.filter(f => f.channelId != null).map(f => f.channelId),
            );
            expect([...channelIds]).toEqual([second.id]);
            expect(codes(report)).not.toContain('store.auth.default-superadmin-password');
            // The fixes of a finding about the active channel need no switch.
            const payment = report.findings.find(f => f.code === 'store.channel.no-payment-method');
            expect(payment?.fixes[0].path).toEqual(['admin_list_payment_options']);

            await expect(check([defaultChannel.id])).rejects.toThrow(/not currently authorized/);
        } finally {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await adminClient.asSuperAdmin();
        }
    });

    it("starts the fixes for another channel's finding by switching to it", async () => {
        const report = await check();
        const payment = report.findings.find(
            f => f.code === 'store.channel.no-payment-method' && f.channelId !== null,
        );
        expect(payment?.fixes.map(fix => fix.path[0])).toEqual([
            'admin_set_active_channel',
            'admin_list_payment_options',
            'admin_create_payment_method',
        ]);
        expect(payment?.fixes[0].input).toEqual({ channelToken: 'second-token' });
    });

    it('refuses an administrator without ReadSettings', async () => {
        const { createRole } = await adminClient.query(
            gql`
                mutation ($input: CreateRoleInput!) {
                    createRole(input: $input) {
                        id
                    }
                }
            `,
            { input: { code: 'catalog-only', description: 'Catalog only', permissions: ['ReadCatalog'] } },
        );
        const { activeChannel } = await adminClient.query(gql`
            query {
                activeChannel {
                    id
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($input: CreateAdministratorInput!) {
                    createAdministrator(input: $input) {
                        id
                    }
                }
            `,
            {
                input: {
                    firstName: 'Catalog',
                    lastName: 'Admin',
                    emailAddress: 'catalog@example.test',
                    password: 'test',
                    roleAssignments: [{ roleId: createRole.id, channelId: activeChannel.id }],
                },
            },
        );
        await adminClient.asUserWithCredentials('catalog@example.test', 'test');
        try {
            await expect(check()).rejects.toThrow(/not currently authorized/);
        } finally {
            await adminClient.asSuperAdmin();
        }
    });
});
