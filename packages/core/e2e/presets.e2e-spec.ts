/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import {
    applyPreset,
    Channel,
    ChannelService,
    ConfigService,
    Country,
    CountryService,
    dummyPaymentHandler,
    isSeedError,
    listPresets,
    loadScenarioPack,
    mergeConfig,
    PaymentMethod,
    PaymentMethodService,
    Preset,
    ProductService,
    RequestContext,
    RequestContextService,
    SEED_PRESET_KEY,
    SEED_SCENARIO_KEY,
    seedScenario,
    SettingsStoreEntry,
    ShippingMethod,
    ShippingMethodService,
    StockLocation,
    StockLocationService,
    TaxCategory,
    TaxCategoryService,
    TaxRate,
    TaxRateService,
    TransactionalConnection,
    User,
    validateScenarioPack,
    Zone,
    ZoneService,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { euPreset } from '../src/data-import/presets/builtin-presets';

import { ISO_COUNTRIES } from '../src/data-import/presets/iso-countries';
import { graphql as adminGraphql } from './graphql/graphql-admin';

import { graphql } from './graphql/graphql-admin';
import {
    createAdministratorDocument,
    createProductDocument,
    createProductVariantsDocument,
    createRoleDocument,
    getSettingsStoreValueDocument,
    getTaxRatesListDocument,
    setSettingsStoreValueDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderWithPriceDataDocument,
    setShippingAddressDocument,
} from './graphql/shop-definitions';

const EMPTY_DATABASE = {
    initialData: {
        defaultLanguage: LanguageCode.en,
        defaultZone: 'none',
        countries: [],
        taxRates: [],
        paymentMethods: [],
        shippingMethods: [],
        collections: [],
    },
    customerCount: 0,
};

const taxStoreReadinessDocument = adminGraphql(`
    query PresetTaxStoreReadiness {
        storeReadiness {
            findings {
                code
            }
        }
    }
`);

describe('Base-data presets', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), { paymentOptions: { paymentMethodHandlers: [dummyPaymentHandler] } }),
    );

    // Restores the empty database that `server.init` cached, so each preset starts from nothing.
    async function resetToEmptyDatabase() {
        await server.destroy();
        await server.init(EMPTY_DATABASE);
    }

    function repo<T extends object>(entity: new (...args: any[]) => T) {
        return server.app.get(TransactionalConnection).rawConnection.getRepository(entity);
    }

    async function sentinelValue(key: string) {
        const entry = await repo(SettingsStoreEntry).findOne({ where: { key } });
        return entry?.value;
    }

    async function defaultChannel() {
        const channelService = server.app.get(ChannelService);
        return channelService.getDefaultChannel(RequestContext.empty());
    }

    async function expectSeedError(promise: Promise<unknown>, code: string) {
        const error = await promise.then(
            () => undefined,
            e => e,
        );
        expect(isSeedError(error), `expected a SeedError, got ${String(error)}`).toBe(true);
        expect(error.vendureCode).toBe(code);
        return error;
    }

    async function superAdminContext() {
        const user = await repo(User).findOne({ where: { identifier: 'superadmin' } });
        return server.app.get(RequestContextService).create({
            apiType: 'admin',
            user: user!,
            channelOrToken: await defaultChannel(),
        });
    }

    async function applyDirectly(preset: Preset, options: Record<string, string>) {
        const app = server.app;
        const services = {
            configService: app.get(ConfigService),
            channelService: app.get(ChannelService),
            zoneService: app.get(ZoneService),
            countryService: app.get(CountryService),
            taxCategoryService: app.get(TaxCategoryService),
            taxRateService: app.get(TaxRateService),
            shippingMethodService: app.get(ShippingMethodService),
            paymentMethodService: app.get(PaymentMethodService),
            stockLocationService: app.get(StockLocationService),
        };
        const ctx = await superAdminContext();
        return app
            .get(TransactionalConnection)
            .withTransaction(ctx, txCtx => preset.apply(txCtx as any, services as any, options));
    }

    /**
     * Creates a "Mug" product with one variant in each tax category, all at `price`, and returns
     * the variant IDs by tax category name.
     */
    async function addMug(price: number): Promise<Record<string, string>> {
        await adminClient.asSuperAdmin();
        const categories = await repo(TaxCategory).find();
        const { createProduct } = await adminClient.query(createProductDocument, {
            input: {
                translations: [{ languageCode: LanguageCode.en, name: 'Mug', slug: 'mug', description: '' }],
            },
        });
        const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
            input: categories.map(category => ({
                productId: createProduct.id,
                sku: `MUG-${category.name.toUpperCase()}`,
                price,
                taxCategoryId: String(category.id),
                translations: [{ languageCode: LanguageCode.en, name: `Mug ${category.name}` }],
                stockOnHand: 100,
            })),
        });
        return Object.fromEntries(
            categories.map(category => [
                category.name,
                createProductVariants.find(v => v?.sku === `MUG-${category.name.toUpperCase()}`)!.id,
            ]),
        );
    }

    beforeAll(async () => {
        await server.init(EMPTY_DATABASE);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('lists the presets', () => {
        expect(listPresets().map(p => p.name)).toEqual(['uk', 'us', 'au', 'single-country']);
        expect(listPresets().find(p => p.name === 'single-country')!.options).toEqual({
            country: expect.objectContaining({ required: true }),
            currency: expect.objectContaining({ required: true }),
        });
    });

    describe('uk', () => {
        it(
            'creates the base data and records the sentinel',
            async () => {
                const result = await applyPreset(server.app, 'uk');

                expect(result.created).toEqual({
                    countries: ISO_COUNTRIES.length,
                    zones: 1,
                    taxCategories: 3,
                    taxRates: 3,
                    shippingMethods: 1,
                    paymentMethods: 1,
                    stockLocations: 0,
                });
                const channel = await defaultChannel();
                expect(channel.defaultCurrencyCode).toBe('GBP');
                expect(channel.availableCurrencyCodes).toEqual(['GBP']);
                expect(channel.availableLanguageCodes).toEqual([LanguageCode.en]);
                expect(channel.pricesIncludeTax).toBe(true);
                expect(channel.defaultTaxZone.name).toBe('UK');
                expect(channel.defaultShippingZone.name).toBe('UK');

                const rates = await repo(TaxRate).find({ relations: { zone: true, category: true } });
                expect(rates.map(r => [r.category.name, r.value, r.zone?.name])).toEqual(
                    expect.arrayContaining([
                        ['Standard', 20, 'UK'],
                        ['Reduced', 5, 'UK'],
                        ['Zero', 0, 'UK'],
                    ]),
                );
                const categories = await repo(TaxCategory).find();
                expect(categories.find(c => c.isDefault)?.name).toBe('Standard');
                expect(await repo(ShippingMethod).count()).toBe(1);
                expect((await repo(PaymentMethod).find())[0].code).toBe('test-payment');
                expect(await repo(StockLocation).count()).toBe(1);
                expect(await repo(Country).count()).toBe(result.created.countries);

                expect(await sentinelValue(SEED_PRESET_KEY)).toEqual({
                    name: 'uk',
                    options: {},
                    appliedAt: expect.any(String),
                });
            },
            TEST_SETUP_TIMEOUT_MS,
        );

        it('refuses a second preset, naming the applied one', async () => {
            const error = await expectSeedError(
                applyPreset(server.app, 'us'),
                'core.preset-database-not-empty',
            );
            expect(error.details.appliedPreset).toBe('uk');
            expect(error.fix[0].description).toContain('uk');
        });

        it(
            'the sentinel is read-only, and readable by the SuperAdmin only',
            async () => {
                await adminClient.asSuperAdmin();
                const { getSettingsStoreValue } = await adminClient.query(getSettingsStoreValueDocument, {
                    key: SEED_PRESET_KEY,
                });
                expect(getSettingsStoreValue).toEqual(expect.objectContaining({ name: 'uk' }));
                const { setSettingsStoreValue } = await adminClient.query(setSettingsStoreValueDocument, {
                    input: { key: SEED_PRESET_KEY, value: { name: 'us' } },
                });
                expect(setSettingsStoreValue.result).toBe(false);
                expect(await sentinelValue(SEED_PRESET_KEY)).toEqual(expect.objectContaining({ name: 'uk' }));

                const { createRole } = await adminClient.query(createRoleDocument, {
                    input: {
                        code: 'settings-reader',
                        description: 'Reads settings',
                        permissions: [Permission.ReadSettings, Permission.UpdateSettings],
                    },
                });
                await adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Settings',
                        lastName: 'Reader',
                        emailAddress: 'settings-reader@test.com',
                        password: 'password',
                        roleIds: [createRole.id],
                    },
                });
                await adminClient.asUserWithCredentials('settings-reader@test.com', 'password');
                const { getSettingsStoreValue: read } = await adminClient.query(
                    getSettingsStoreValueDocument,
                    { key: SEED_PRESET_KEY },
                );
                expect(read).toBeNull();
                await adminClient.asSuperAdmin();
            },
            TEST_SETUP_TIMEOUT_MS,
        );
    });

    describe('us', () => {
        beforeAll(resetToEmptyDatabase, TEST_SETUP_TIMEOUT_MS);

        it(
            'prices exclude tax and the only rate is 0',
            async () => {
                await applyPreset(server.app, 'us');
                const channel = await defaultChannel();
                expect(channel.defaultCurrencyCode).toBe('USD');
                expect(channel.pricesIncludeTax).toBe(false);
                const rates = await repo(TaxRate).find();
                expect(rates.map(r => r.value)).toEqual([0]);
            },
            TEST_SETUP_TIMEOUT_MS,
        );
    });

    describe('au', () => {
        beforeAll(resetToEmptyDatabase, TEST_SETUP_TIMEOUT_MS);

        it(
            'prices include GST at 10',
            async () => {
                await applyPreset(server.app, 'au');
                const channel = await defaultChannel();
                expect(channel.defaultCurrencyCode).toBe('AUD');
                expect(channel.pricesIncludeTax).toBe(true);
                expect(channel.defaultTaxZone.name).toBe('AU');
                const rates = await repo(TaxRate).find({ relations: { category: true } });
                expect(rates.map(r => [r.category.name, r.value])).toEqual(
                    expect.arrayContaining([
                        ['Standard', 10],
                        ['Zero', 0],
                    ]),
                );
            },
            TEST_SETUP_TIMEOUT_MS,
        );
    });

    describe('single-country', () => {
        beforeAll(resetToEmptyDatabase, TEST_SETUP_TIMEOUT_MS);

        it('requires the country and the currency', async () => {
            const error = await expectSeedError(
                applyPreset(server.app, 'single-country', { country: 'NZ' }),
                'core.preset-invalid-option',
            );
            expect(error.details).toEqual(
                expect.objectContaining({ option: 'currency', reason: 'is required' }),
            );
        });

        it('rejects an unknown country or currency, and an unknown option', async () => {
            await expectSeedError(
                applyPreset(server.app, 'single-country', { country: 'XX', currency: 'NZD' }),
                'core.preset-invalid-option',
            );
            await expectSeedError(
                applyPreset(server.app, 'single-country', { country: 'NZ', currency: 'XXX' }),
                'core.preset-invalid-option',
            );
            await expectSeedError(
                applyPreset(server.app, 'single-country', { country: 'NZ', currency: 'NZD', foo: 'x' }),
                'core.preset-invalid-option',
            );
        });

        it('rejects an unknown preset', async () => {
            await expectSeedError(applyPreset(server.app, 'mars'), 'core.preset-unknown');
        });

        it(
            'creates one zone and one standard rate at 0',
            async () => {
                await applyPreset(server.app, 'single-country', { country: 'NZ', currency: 'NZD' });
                const channel = await defaultChannel();
                expect(channel.defaultCurrencyCode).toBe('NZD');
                const zones = await repo(Zone).find({ relations: { members: true } });
                expect(zones.map(z => [z.name, z.members.map(m => m.code)])).toEqual([['NZ', ['NZ']]]);
                const rates = await repo(TaxRate).find();
                expect(rates.map(r => [r.name, r.value])).toEqual([['Standard rate, set the value', 0]]);
                expect(await sentinelValue(SEED_PRESET_KEY)).toEqual(
                    expect.objectContaining({
                        name: 'single-country',
                        options: { country: 'NZ', currency: 'NZD' },
                    }),
                );
            },
            TEST_SETUP_TIMEOUT_MS,
        );
    });

    describe('eu', () => {
        beforeAll(resetToEmptyDatabase, TEST_SETUP_TIMEOUT_MS);

        it('is hidden until its VAT rates are reviewed', async () => {
            expect(listPresets().map(p => p.name)).not.toContain('eu');
            await expectSeedError(applyPreset(server.app, 'eu', { country: 'DE' }), 'core.preset-unknown');
        });

        // The preset is unreleased, so these tests call it directly, in a transaction as
        // applyPreset() does.
        describe('applied directly', () => {
            it('requires the seller country to be a member state', () => {
                expect(euPreset.validate!({})).toEqual(expect.objectContaining({ option: 'country' }));
                expect(euPreset.validate!({ country: 'GB' })).toEqual(
                    expect.objectContaining({ option: 'country' }),
                );
                expect(euPreset.validate!({ country: 'DE' })).toBeUndefined();
            });

            it(
                'creates a standard and a reduced rate per member state, with the seller country as tax country',
                async () => {
                    const result = await applyDirectly(euPreset, { country: 'DE' });
                    expect(result.created.taxRates).toBe(2 * 27);
                    expect(result.channel.taxCountryCode).toBe('DE');
                    const channel = await defaultChannel();
                    expect(channel.defaultCurrencyCode).toBe('EUR');
                    expect(channel.pricesIncludeTax).toBe(true);
                    expect(channel.taxCountryCode).toBe('DE');
                    const zone = await repo(Zone).findOne({
                        where: { name: 'EU' },
                        relations: { members: true },
                    });
                    expect(zone!.members.length).toBe(27);

                    await adminClient.asSuperAdmin();
                    const { taxRates } = await adminClient.query(getTaxRatesListDocument, {
                        options: { take: 100 },
                    });
                    // The DE country rates are the included rates, so the zone has none
                    expect(taxRates.items.filter(r => r.zone?.name === 'EU')).toEqual([]);
                    const de = taxRates.items.filter(r => r.region?.code === 'DE');
                    expect(de.map(r => [r.category.name, r.value]).sort()).toEqual([
                        ['Reduced', 7],
                        ['Standard', 19],
                    ]);
                },
                TEST_SETUP_TIMEOUT_MS,
            );

            it(
                'prices a DE and an FR order at the country rate',
                async () => {
                    const variantIds = await addMug(1190);
                    await shopClient.asAnonymousUser();
                    await shopClient.query(addItemToOrderDocument, {
                        productVariantId: variantIds.Standard,
                        quantity: 1,
                    });

                    async function lineFor(countryCode: string) {
                        await shopClient.query(setShippingAddressDocument, {
                            input: {
                                countryCode,
                                streetLine1: '1 Main St',
                                city: 'City',
                                postalCode: '12345',
                            },
                        });
                        const { activeOrder } = await shopClient.query(getActiveOrderWithPriceDataDocument);
                        return activeOrder!.lines[0];
                    }

                    const de = await lineFor('DE');
                    expect(de.taxRate).toBe(19);
                    expect(de.unitPriceWithTax).toBe(1190);

                    // The entered price includes the DE rate. FR takes out 19% and adds 20%.
                    const fr = await lineFor('FR');
                    expect(fr.taxRate).toBe(20);
                    expect(fr.unitPrice).toBe(1000);
                    expect(fr.unitPriceWithTax).toBe(1200);
                },
                TEST_SETUP_TIMEOUT_MS,
            );

            it('passes the tax checks of the store check', async () => {
                await adminClient.asSuperAdmin();
                const { storeReadiness } = await adminClient.query(taxStoreReadinessDocument);
                expect(
                    storeReadiness.findings
                        .map(f => f.code)
                        .filter(
                            code => code.startsWith('store.tax.') || code.startsWith('store.channel.tax'),
                        ),
                ).toEqual([]);
            });
        });
    });

    describe('refusals', () => {
        const createdBefore: Array<[string, (ctx: RequestContext) => Promise<unknown>]> = [
            [
                'products',
                ctx =>
                    server.app.get(ProductService).create(ctx, {
                        translations: [
                            { languageCode: LanguageCode.en, name: 'P', slug: 'p', description: '' },
                        ],
                    }),
            ],
            ['taxCategories', ctx => server.app.get(TaxCategoryService).create(ctx, { name: 'Existing' })],
            [
                'shippingMethods',
                ctx =>
                    server.app.get(ShippingMethodService).create(ctx, {
                        code: 'existing',
                        fulfillmentHandler: 'manual-fulfillment',
                        checker: { code: 'default-shipping-eligibility-checker', arguments: [] },
                        calculator: { code: 'default-shipping-calculator', arguments: [] },
                        translations: [{ languageCode: LanguageCode.en, name: 'Existing', description: '' }],
                    }),
            ],
            [
                'paymentMethods',
                ctx =>
                    server.app.get(PaymentMethodService).create(ctx, {
                        code: 'existing',
                        enabled: true,
                        handler: {
                            code: dummyPaymentHandler.code,
                            arguments: [{ name: 'automaticSettle', value: 'false' }],
                        },
                        translations: [{ languageCode: LanguageCode.en, name: 'Existing', description: '' }],
                    }),
            ],
            ['zones', ctx => server.app.get(ZoneService).create(ctx, { name: 'Existing' })],
            [
                'channels',
                () =>
                    repo(Channel).save(
                        repo(Channel).create({
                            code: 'second',
                            token: 'second',
                            defaultLanguageCode: LanguageCode.en,
                            availableLanguageCodes: [LanguageCode.en],
                            defaultCurrencyCode: CurrencyCode.USD,
                            availableCurrencyCodes: [CurrencyCode.USD],
                            pricesIncludeTax: false,
                        }),
                    ),
            ],
        ];

        it.each(createdBefore)(
            'refuses a database that has %s, and writes nothing',
            async (field, create) => {
                await resetToEmptyDatabase();
                await create(await superAdminContext());

                const error = await expectSeedError(
                    applyPreset(server.app, 'uk'),
                    'core.preset-database-not-empty',
                );
                const counts = { ...error.details };
                delete counts.appliedPreset;
                expect(counts).toEqual({
                    countries: 0,
                    zones: 0,
                    taxRates: 0,
                    taxCategories: 0,
                    shippingMethods: 0,
                    paymentMethods: 0,
                    products: 0,
                    channels: 1,
                    [field]: field === 'channels' ? 2 : 1,
                });
                expect(await repo(Country).count()).toBe(0);
                expect(await sentinelValue(SEED_PRESET_KEY)).toBeUndefined();
            },
            TEST_SETUP_TIMEOUT_MS,
        );
    });

    // A store seeded by any preset passes the store check once it sells a product in each of its
    // tax categories. The tax-inclusive presets put a zone rate on the default tax zone, so the check
    // knows the rate entered prices include. The only finding left is the warning about the test
    // SuperAdmin password.
    describe('store readiness', () => {
        const storeReadinessDocument = graphql(`
            query StoreReadiness {
                storeReadiness {
                    ready
                    findings {
                        code
                        severity
                    }
                }
            }
        `);

        it.each<[string, Record<string, string>]>([
            ['uk', {}],
            ['au', {}],
            ['us', {}],
            ['single-country', { country: 'NZ', currency: 'NZD' }],
        ])(
            'a store seeded with the %s preset is ready',
            async (preset, options) => {
                await resetToEmptyDatabase();
                await applyPreset(server.app, preset, options);
                await addMug(1000);

                const { storeReadiness } = await adminClient.query(storeReadinessDocument);

                expect(storeReadiness.findings).toEqual([
                    { code: 'store.auth.default-superadmin-password', severity: 'WARNING' },
                ]);
                expect(storeReadiness.ready).toBe(true);
            },
            TEST_SETUP_TIMEOUT_MS,
        );

        // eu is unreleased, so it is applied directly.
        it(
            'a store seeded with the eu preset is ready',
            async () => {
                await resetToEmptyDatabase();
                await applyDirectly(euPreset, { country: 'DE' });
                await addMug(1000);

                const { storeReadiness } = await adminClient.query(storeReadinessDocument);

                expect(storeReadiness.findings).toEqual([
                    { code: 'store.auth.default-superadmin-password', severity: 'WARNING' },
                ]);
                expect(storeReadiness.ready).toBe(true);
            },
            TEST_SETUP_TIMEOUT_MS,
        );
    });

    describe('a failure rolls back the data and the sentinel', () => {
        beforeAll(resetToEmptyDatabase, TEST_SETUP_TIMEOUT_MS);

        it(
            'leaves neither data nor sentinel, and the preset can then run',
            async () => {
                const spy = vi
                    .spyOn(server.app.get(ShippingMethodService), 'create')
                    .mockRejectedValueOnce(new Error('forced failure'));
                await expect(applyPreset(server.app, 'uk')).rejects.toThrow('forced failure');
                spy.mockRestore();

                expect(await repo(Country).count()).toBe(0);
                expect(await repo(Zone).count()).toBe(0);
                expect(await repo(TaxRate).count()).toBe(0);
                expect(await sentinelValue(SEED_PRESET_KEY)).toBeUndefined();

                await applyPreset(server.app, 'uk');
                expect(await sentinelValue(SEED_PRESET_KEY)).toEqual(expect.objectContaining({ name: 'uk' }));
            },
            TEST_SETUP_TIMEOUT_MS,
        );
    });

    describe('in production', () => {
        beforeAll(resetToEmptyDatabase, TEST_SETUP_TIMEOUT_MS);

        it(
            'creates no test payment method',
            async () => {
                const originalNodeEnv = process.env.NODE_ENV;
                process.env.NODE_ENV = 'production';
                try {
                    const result = await applyPreset(server.app, 'uk');
                    expect(result.created.paymentMethods).toBe(0);
                    expect(result.notices).toEqual([
                        'No test payment method was created, because NODE_ENV is production.',
                    ]);
                } finally {
                    process.env.NODE_ENV = originalNodeEnv;
                }
                expect(await repo(PaymentMethod).count()).toBe(0);
            },
            TEST_SETUP_TIMEOUT_MS,
        );
    });

    describe('seedScenario', () => {
        const reference = { name: 'fixture', package: './fixture-scenario', version: '1.0.0' };

        beforeAll(resetToEmptyDatabase, TEST_SETUP_TIMEOUT_MS);

        it('validates the manifest preset', () => {
            expect(() =>
                validateScenarioPack({ name: 'x', preset: 'mars', seed: () => undefined }, 'pkg'),
            ).toThrow('unknown preset "mars"');
            expect(() => validateScenarioPack({ name: 'x', preset: 'uk' }, 'pkg')).toThrow(
                'no seed function',
            );
            expect(
                validateScenarioPack({ name: 'x', preset: 'uk', seed: () => Promise.resolve() }, 'pkg')
                    .preset,
            ).toBe('uk');
        });

        it('refuses before the scenario preset is applied', async () => {
            const pack = validateScenarioPack(
                { name: 'fixture', preset: 'uk', seed: () => Promise.resolve() },
                'pkg',
            );
            const error = await expectSeedError(
                seedScenario(server.app, reference, pack),
                'core.scenario-preset-mismatch',
            );
            expect(error.details.appliedPreset).toBeUndefined();
        });

        it(
            'a failed scenario leaves no data and no sentinel, and runs again',
            async () => {
                await applyPreset(server.app, 'uk');
                const failing = validateScenarioPack(
                    {
                        name: 'fixture',
                        preset: 'uk',
                        seed: async (ctx: RequestContext, app: any) => {
                            await app.get(ZoneService).create(ctx, { name: 'scenario zone' });
                            throw new Error('scenario failed');
                        },
                    },
                    'pkg',
                );
                await expect(seedScenario(server.app, reference, failing)).rejects.toThrow('scenario failed');
                expect(await repo(Zone).count({ where: { name: 'scenario zone' } })).toBe(0);
                expect(await sentinelValue(SEED_SCENARIO_KEY)).toBeUndefined();

                const afterCommit = vi.fn(() => Promise.resolve());
                const pack = validateScenarioPack(
                    {
                        name: 'fixture',
                        preset: 'uk',
                        seed: async (ctx: RequestContext, app: any) => {
                            await app.get(ZoneService).create(ctx, { name: 'scenario zone' });
                        },
                        afterCommit,
                    },
                    'pkg',
                );
                await seedScenario(server.app, reference, pack);
                expect(await repo(Zone).count({ where: { name: 'scenario zone' } })).toBe(1);
                expect(afterCommit).toHaveBeenCalledTimes(1);
                expect(await sentinelValue(SEED_SCENARIO_KEY)).toEqual({
                    name: 'fixture',
                    package: './fixture-scenario',
                    version: '1.0.0',
                    appliedAt: expect.any(String),
                });

                await expectSeedError(
                    seedScenario(server.app, reference, pack),
                    'core.scenario-already-seeded',
                );
            },
            TEST_SETUP_TIMEOUT_MS,
        );

        it('refuses a scenario that builds on another preset', async () => {
            await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(SettingsStoreEntry)
                .delete({ key: SEED_SCENARIO_KEY });
            const pack = validateScenarioPack(
                { name: 'fixture', preset: 'us', seed: () => Promise.resolve() },
                'pkg',
            );
            const error = await expectSeedError(
                seedScenario(server.app, reference, pack),
                'core.scenario-preset-mismatch',
            );
            expect(error.details.appliedPreset).toBe('uk');
        });

        it('refuses a pack whose name differs from the record', async () => {
            const pack = validateScenarioPack(
                { name: 'other', preset: 'uk', seed: () => Promise.resolve() },
                'pkg',
            );
            await expectSeedError(seedScenario(server.app, reference, pack), 'core.scenario-invalid');
        });

        it('loads a scenario pack from a package', () => {
            const pack = loadScenarioPack(reference, path.join(__dirname, 'fixtures/seed-scenario'));
            expect(pack.name).toBe('fixture');
            expect(pack.preset).toBe('uk');
        });
    });
});
