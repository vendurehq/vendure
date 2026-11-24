/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    applyPreset,
    ChannelService,
    Country,
    dummyPaymentHandler,
    isSeedError,
    listPresets,
    loadScenarioPack,
    mergeConfig,
    PaymentMethod,
    RequestContext,
    SEED_PRESET_KEY,
    SEED_SCENARIO_KEY,
    seedScenario,
    SeedSentinelService,
    SettingsStoreEntry,
    ShippingMethod,
    ShippingMethodService,
    StockLocation,
    TaxCategory,
    TaxRate,
    TransactionalConnection,
    validateScenarioPack,
    Zone,
    ZoneService,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    createChannelDocument,
    createProductDocument,
    createProductVariantsDocument,
    getTaxRatesListDocument,
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

    beforeAll(async () => {
        await server.init(EMPTY_DATABASE);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('lists the presets', () => {
        expect(listPresets().map(p => p.name)).toEqual(['eu', 'uk', 'us', 'au', 'single-country']);
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
                    countries: expect.any(Number),
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

        it('the sentinel is read-only and readable by the SuperAdmin only', () => {
            const sentinels = server.app.get(SeedSentinelService);
            expect(sentinels).toBeDefined();
            const settingsStore = (sentinels as any).settingsStoreService;
            expect(settingsStore.isReadonly(SEED_PRESET_KEY)).toBe(true);
            expect(settingsStore.isReadonly(SEED_SCENARIO_KEY)).toBe(true);
            expect(settingsStore.getFieldDefinition(SEED_PRESET_KEY).requiresPermission).toBe('SuperAdmin');
        });
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

        it('requires the seller country to be a member state', async () => {
            await expectSeedError(applyPreset(server.app, 'eu'), 'core.preset-invalid-option');
            await expectSeedError(
                applyPreset(server.app, 'eu', { country: 'GB' }),
                'core.preset-invalid-option',
            );
        });

        it(
            'creates a standard and a reduced rate per member state, and zone rates at the seller rate',
            async () => {
                const result = await applyPreset(server.app, 'eu', { country: 'DE' });
                expect(result.created.taxRates).toBe(2 * 27 + 2);
                const channel = await defaultChannel();
                expect(channel.defaultCurrencyCode).toBe('EUR');
                expect(channel.pricesIncludeTax).toBe(true);
                const zone = await repo(Zone).findOne({
                    where: { name: 'EU' },
                    relations: { members: true },
                });
                expect(zone!.members.length).toBe(27);

                await adminClient.asSuperAdmin();
                const { taxRates } = await adminClient.query(getTaxRatesListDocument, {
                    options: { take: 100 },
                });
                const zoneRates = taxRates.items.filter(r => r.zone?.name === 'EU');
                expect(zoneRates.map(r => [r.category.name, r.value]).sort()).toEqual([
                    ['Reduced', 7],
                    ['Standard', 19],
                ]);
            },
            TEST_SETUP_TIMEOUT_MS,
        );

        it(
            'prices a DE and an FR order at the country rate',
            async () => {
                await adminClient.asSuperAdmin();
                const categories = await repo(TaxCategory).find();
                const standard = categories.find(c => c.name === 'Standard')!;
                const { createProduct } = await adminClient.query(createProductDocument, {
                    input: {
                        translations: [
                            { languageCode: LanguageCode.en, name: 'Mug', slug: 'mug', description: '' },
                        ],
                    },
                });
                const { createProductVariants } = await adminClient.query(createProductVariantsDocument, {
                    input: [
                        {
                            productId: createProduct.id,
                            sku: 'MUG',
                            price: 1190,
                            taxCategoryId: String(standard.id),
                            translations: [{ languageCode: LanguageCode.en, name: 'Mug' }],
                            stockOnHand: 100,
                        },
                    ],
                });
                await shopClient.asAnonymousUser();
                await shopClient.query(addItemToOrderDocument, {
                    productVariantId: createProductVariants[0]!.id,
                    quantity: 1,
                });

                async function lineFor(countryCode: string) {
                    await shopClient.query(setShippingAddressDocument, {
                        input: { countryCode, streetLine1: '1 Main St', city: 'City', postalCode: '12345' },
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
    });

    describe('refusals', () => {
        beforeAll(resetToEmptyDatabase, TEST_SETUP_TIMEOUT_MS);

        it(
            'refuses a database that has a second channel, and writes nothing',
            async () => {
                const zone = await server.app
                    .get(ZoneService)
                    .create(RequestContext.empty(), { name: 'temp' });
                await adminClient.asSuperAdmin();
                await adminClient.query(createChannelDocument, {
                    input: {
                        code: 'second',
                        token: 'second',
                        defaultLanguageCode: LanguageCode.en,
                        defaultCurrencyCode: CurrencyCode.USD,
                        pricesIncludeTax: false,
                        defaultShippingZoneId: String(zone.id),
                        defaultTaxZoneId: String(zone.id),
                    },
                });

                const error = await expectSeedError(
                    applyPreset(server.app, 'uk'),
                    'core.preset-database-not-empty',
                );
                expect(error.details).toEqual(
                    expect.objectContaining({ channels: 2, zones: 1, taxRates: 0 }),
                );
                expect(error.message).toContain('2 channels');
                expect(await repo(Country).count()).toBe(0);
                expect(await sentinelValue(SEED_PRESET_KEY)).toBeUndefined();
            },
            TEST_SETUP_TIMEOUT_MS,
        );

        it(
            'refuses a database that has a zone',
            async () => {
                await resetToEmptyDatabase();
                await server.app.get(ZoneService).create(RequestContext.empty(), { name: 'existing' });
                const error = await expectSeedError(
                    applyPreset(server.app, 'uk'),
                    'core.preset-database-not-empty',
                );
                expect(error.details).toEqual(expect.objectContaining({ zones: 1 }));
                expect(error.details.appliedPreset).toBeUndefined();
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
                { name: 'other', preset: 'us', seed: () => Promise.resolve() },
                'pkg',
            );
            const error = await expectSeedError(
                seedScenario(server.app, reference, pack),
                'core.scenario-preset-mismatch',
            );
            expect(error.details.appliedPreset).toBe('uk');
        });

        it('loads a scenario pack from a package', () => {
            const pack = loadScenarioPack(reference, path.join(__dirname, 'fixtures/seed-scenario'));
            expect(pack.name).toBe('fixture');
            expect(pack.preset).toBe('uk');
        });
    });
});
