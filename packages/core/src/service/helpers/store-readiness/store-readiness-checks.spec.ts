import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import { describe, expect, it, vi } from 'vitest';

import { checkDefaultZones, noDefaultShippingZone, noDefaultTaxZone } from './default-zones.check';
import { checkPaymentMethods, noEnabledPaymentMethod } from './payment-methods.check';
import { missingPrices } from './prices.check';
import { searchIndexIncomplete } from './search-index.check';
import { findShippingZones, sampleCountryCode, zoneWithoutEnabledCountry } from './shipping-zones';
import {
    checkShipping,
    noEligibleShippingMethod,
    noSellableVariant,
    noShippingMethod,
} from './shipping.check';
import { checkStockLocations, noStockLocation } from './stock-locations.check';
import { ChannelReadinessInput } from './store-readiness-types';
import { checkSuperadminCredentials, defaultSuperadminPassword } from './superadmin-credentials.check';
import { ambiguousZoneRates, checkTaxRateOverlaps } from './tax-rate-overlaps.check';
import { checkTaxRates, noApplicableTaxRate } from './tax-rates.check';

const ctx = {} as any;

function country(code: string, enabled = true) {
    return { id: `country-${code}`, code, enabled } as any;
}

function zone(id: string, members: any[]) {
    return { id, name: `Zone ${id}`, members } as any;
}

function channel(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        code: 'default',
        defaultLanguageCode: LanguageCode.en,
        defaultCurrencyCode: CurrencyCode.USD,
        availableCurrencyCodes: [CurrencyCode.USD],
        defaultTaxZone: { id: 'z1' },
        defaultShippingZone: { id: 'z1' },
        ...overrides,
    } as any;
}

function input(overrides: Partial<ChannelReadinessInput> = {}): ChannelReadinessInput {
    return { ctx, channel: channel(), shippingZones: [zone('z1', [country('DE')])], ...overrides };
}

/** A TypeORM query builder stand-in: every chained call returns it, and the terminal calls resolve. */
function queryBuilder(results: { getOne?: unknown; getCount?: number; getRawMany?: unknown[] }) {
    const builder: any = new Proxy(
        {},
        {
            get: (_target, prop) => {
                if (prop === 'getOne') return () => Promise.resolve(results.getOne);
                if (prop === 'getCount') return () => Promise.resolve(results.getCount ?? 0);
                if (prop === 'getRawMany') return () => Promise.resolve(results.getRawMany ?? []);
                return () => builder;
            },
        },
    );
    return builder;
}

describe('store readiness codes', () => {
    it('are namespaced, lower-case codes under "store."', () => {
        const definitions = [
            noDefaultTaxZone,
            noDefaultShippingZone,
            missingPrices,
            noApplicableTaxRate,
            ambiguousZoneRates,
            noShippingMethod,
            noSellableVariant,
            noEligibleShippingMethod,
            noEnabledPaymentMethod,
            noStockLocation,
            searchIndexIncomplete,
            defaultSuperadminPassword,
            zoneWithoutEnabledCountry,
        ];
        for (const definition of definitions) {
            expect(definition.code).toMatch(/^store(\.[a-z0-9-]+)+$/);
        }
        expect(new Set(definitions.map(d => d.code)).size).toBe(definitions.length);
    });
});

describe('checkDefaultZones', () => {
    it('reports both missing default zones, suggesting a zone the channel ships to', () => {
        const findings = checkDefaultZones(
            input({ channel: channel({ defaultTaxZone: null, defaultShippingZone: null }) }),
        );
        expect(findings.map(f => f.code)).toEqual([
            'store.channel.no-default-tax-zone',
            'store.channel.no-default-shipping-zone',
        ]);
        expect(findings[0]).toMatchObject({ severity: 'error', channelId: 1, dashboardUrl: '/channels/1' });
        expect(findings[0].fixes).toEqual([
            expect.objectContaining({
                path: ['admin_update_channel'],
                input: { id: 1, input: { defaultTaxZoneId: 'z1' } },
            }),
        ]);
    });

    it('gives no fix when the channel ships nowhere, and reports nothing when both are set', () => {
        const [finding] = checkDefaultZones(
            input({ channel: channel({ defaultTaxZone: null }), shippingZones: [] }),
        );
        expect(finding.fixes).toEqual([]);
        expect(checkDefaultZones(input())).toEqual([]);
    });
});

describe('findShippingZones', () => {
    it('keeps zones with an enabled country and warns about the others', async () => {
        const zoneService = {
            getAllWithMembers: () =>
                Promise.resolve([
                    zone('z1', [country('DE'), country('AT', false)]),
                    zone('z2', [country('FR', false)]),
                    zone('z3', []),
                ]),
        } as any;
        const { shippingZones, findings } = await findShippingZones(ctx, zoneService);
        expect(shippingZones.map(z => z.id)).toEqual(['z1']);
        expect(findings.map(f => [f.code, f.severity, f.zoneId])).toEqual([
            ['store.zone.no-enabled-country', 'warning', 'z2'],
            ['store.zone.no-enabled-country', 'warning', 'z3'],
        ]);
        expect(findings[0].fixes[0]).toMatchObject({
            path: ['admin_enable_countries'],
            input: { codes: ['FR'] },
        });
        expect(findings[1].fixes[0]).toMatchObject({ path: ['admin_update_zone'] });
    });

    it('samples the first enabled country by code', () => {
        expect(sampleCountryCode(zone('z', [country('FR'), country('AT', false), country('DE')]))).toBe('DE');
    });
});

describe('checkTaxRates', () => {
    it('reports the enabled countries of a zone that no rate applies to', async () => {
        const connection = {
            getRepository: () => ({
                createQueryBuilder: () => queryBuilder({ getRawMany: [{ taxCategoryId: 'tc1' }] }),
                find: () => Promise.resolve([{ id: 'tc1', name: 'Standard' }]),
            }),
        } as any;
        const taxRateService = {
            getApplicableTaxRate: vi.fn((_ctx: unknown, target: { countryCode: string }) =>
                Promise.resolve({ id: target.countryCode === 'DE' ? '7' : '0' }),
            ),
        } as any;
        const findings = await checkTaxRates(
            input({
                shippingZones: [
                    zone('z1', [country('FR'), country('DE'), country('BE'), country('NL', false)]),
                ],
            }),
            connection,
            taxRateService,
        );
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            code: 'store.tax.no-rate',
            zoneId: 'z1',
            taxCategoryId: 'tc1',
            channelId: 1,
        });
        expect(findings[0].message).toContain('BE, FR');
        expect(findings[0].message).not.toContain('NL');
        expect(taxRateService.getApplicableTaxRate).toHaveBeenCalledTimes(3);
    });

    it('reports nothing when the channel has no variants', async () => {
        const connection = {
            getRepository: () => ({ createQueryBuilder: () => queryBuilder({ getRawMany: [] }) }),
        } as any;
        expect(await checkTaxRates(input(), connection, {} as any)).toEqual([]);
    });
});

describe('checkTaxRateOverlaps', () => {
    it('reports each overlap as a warning with a country-rate fix', async () => {
        const taxRateService = {
            findOverlappingZoneRates: () =>
                Promise.resolve([
                    { countryCode: 'AT', taxCategoryId: 'tc1', taxRates: [{ name: 'A' }, { name: 'B' }] },
                ]),
        } as any;
        const [finding] = await checkTaxRateOverlaps(ctx, taxRateService);
        expect(finding).toMatchObject({
            code: 'store.tax.ambiguous-zone-rates',
            severity: 'warning',
            countryCode: 'AT',
            taxCategoryId: 'tc1',
        });
        expect(finding.fixes[0].input).toMatchObject({ input: { target: { countryCode: 'AT' } } });
    });
});

describe('checkShipping', () => {
    const services = (overrides: { methods?: number; variant?: unknown; quotes?: unknown[] }) => ({
        connection: {
            getRepository: () => ({ createQueryBuilder: () => queryBuilder({ getOne: overrides.variant }) }),
        } as any,
        shippingMethodService: {
            findAll: () => Promise.resolve({ items: [], totalItems: overrides.methods ?? 1 }),
        } as any,
        orderTestingService: {
            testEligibleShippingMethods: vi.fn(() => Promise.resolve(overrides.quotes ?? [])),
        } as any,
    });

    it('reports a channel with no shipping method', async () => {
        const findings = await checkShipping(input(), services({ methods: 0 }));
        expect(findings.map(f => f.code)).toEqual(['store.channel.no-shipping-method']);
    });

    it('reports a channel with nothing to sell and skips the sample orders', async () => {
        const deps = services({ variant: undefined });
        const findings = await checkShipping(input(), deps);
        expect(findings.map(f => f.code)).toEqual(['store.channel.no-sellable-variant']);
        expect(deps.orderTestingService.testEligibleShippingMethods).not.toHaveBeenCalled();
    });

    it('prices one sample order per zone and reports the zones with no eligible method', async () => {
        const deps = services({ variant: { id: 'v1' }, quotes: [] });
        const findings = await checkShipping(
            input({ shippingZones: [zone('z1', [country('FR'), country('DE')])] }),
            deps,
        );
        expect(deps.orderTestingService.testEligibleShippingMethods).toHaveBeenCalledWith(ctx, {
            shippingAddress: expect.objectContaining({ countryCode: 'DE' }),
            lines: [{ productVariantId: 'v1', quantity: 1 }],
        });
        expect(findings).toEqual([
            expect.objectContaining({
                code: 'store.shipping.no-eligible-method',
                zoneId: 'z1',
                countryCode: 'DE',
            }),
        ]);
    });

    it('reports nothing when a method is eligible', async () => {
        expect(
            await checkShipping(input(), services({ variant: { id: 'v1' }, quotes: [{ id: 'm1' }] })),
        ).toEqual([]);
    });
});

describe('checkPaymentMethods and checkStockLocations', () => {
    it('suggest creating a method with the first configured handler', async () => {
        const paymentMethodService = { findAll: () => Promise.resolve({ items: [], totalItems: 0 }) } as any;
        const configService = { paymentOptions: { paymentMethodHandlers: [{ code: 'card' }] } } as any;
        const [finding] = await checkPaymentMethods(input(), paymentMethodService, configService);
        expect(finding.code).toBe('store.channel.no-payment-method');
        expect(finding.fixes[1].input).toMatchObject({ input: { handler: { code: 'card' } } });
    });

    it('give no fix when no payment handler is configured', async () => {
        const paymentMethodService = { findAll: () => Promise.resolve({ items: [], totalItems: 0 }) } as any;
        const configService = { paymentOptions: { paymentMethodHandlers: [] } } as any;
        const [finding] = await checkPaymentMethods(input(), paymentMethodService, configService);
        expect(finding.fixes).toEqual([]);
        expect(finding.message).toContain('no payment handler');
    });

    it('report a channel with no stock location', async () => {
        const stockLocationService = { findAll: () => Promise.resolve({ items: [], totalItems: 0 }) } as any;
        const [finding] = await checkStockLocations(input(), stockLocationService);
        expect(finding).toMatchObject({ code: 'store.channel.no-stock-location', severity: 'error' });
        const present = { findAll: () => Promise.resolve({ items: [{}], totalItems: 1 }) } as any;
        expect(await checkStockLocations(input(), present)).toEqual([]);
    });
});

describe('checkSuperadminCredentials', () => {
    function deps(passwordHash: string | undefined, matches: boolean) {
        const check = vi.fn(() => Promise.resolve(matches));
        return {
            check,
            services: {
                connection: {
                    getRepository: () => ({
                        createQueryBuilder: () =>
                            queryBuilder({ getOne: passwordHash ? { passwordHash } : undefined }),
                    }),
                } as any,
                configService: {
                    authOptions: { superadminCredentials: { identifier: 'superadmin' } },
                } as any,
                passwordCipher: { check } as any,
            },
        };
    }

    it('warns while the superadmin still has the default password', async () => {
        const { check, services } = deps('hash', true);
        const findings = await checkSuperadminCredentials(ctx, services);
        expect(check).toHaveBeenCalledWith(SUPER_ADMIN_USER_PASSWORD, 'hash');
        expect(findings).toEqual([
            expect.objectContaining({ code: 'store.auth.default-superadmin-password', severity: 'warning' }),
        ]);
    });

    it('reports nothing once the password is changed, or when there is no superadmin login', async () => {
        expect(await checkSuperadminCredentials(ctx, deps('hash', false).services)).toEqual([]);
        expect(await checkSuperadminCredentials(ctx, deps(undefined, true).services)).toEqual([]);
    });
});
