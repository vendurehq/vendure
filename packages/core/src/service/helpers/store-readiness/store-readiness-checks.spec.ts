import { isValidErrorCode } from '@vendure/common/lib/command';
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_PASSWORD } from '@vendure/common/lib/shared-constants';
import { describe, expect, it, vi } from 'vitest';

import { AddressBasedTaxZoneStrategy } from '../../../config/tax/address-based-tax-zone-strategy';
import { DefaultTaxZoneStrategy } from '../../../config/tax/default-tax-zone-strategy';
import { checkFailed } from '../../services/store-readiness.service';

import * as channelTaxCountryModule from './channel-tax-country.check';
import { checkChannelTaxCountry } from './channel-tax-country.check';
import * as defaultZonesModule from './default-zones.check';
import { checkDefaultZones } from './default-zones.check';
import * as paymentMethodsModule from './payment-methods.check';
import { checkPaymentMethods } from './payment-methods.check';
import * as pricesModule from './prices.check';
import { checkPrices } from './prices.check';
import * as searchIndexModule from './search-index.check';
import { checkSearchIndex } from './search-index.check';
import * as shippingZonesModule from './shipping-zones';
import { findShippingZones, sampleCountryCode } from './shipping-zones';
import * as shippingModule from './shipping.check';
import { checkShipping } from './shipping.check';
import * as stockLocationsModule from './stock-locations.check';
import { checkStockLocations } from './stock-locations.check';
import { ChannelReadinessInput } from './store-readiness-types';
import * as superadminModule from './superadmin-credentials.check';
import { checkSuperadminCredentials } from './superadmin-credentials.check';
import * as taxInclusiveRatesModule from './tax-inclusive-rates.check';
import { checkTaxInclusiveRates } from './tax-inclusive-rates.check';
import * as taxRateOverlapsModule from './tax-rate-overlaps.check';
import { checkTaxRateOverlaps } from './tax-rate-overlaps.check';
import * as taxRatesModule from './tax-rates.check';
import { checkTaxRates } from './tax-rates.check';

const ctx = {} as any;
/** The context each sample order gets, so a cached tax zone does not carry over. */
const freshCtx = { fresh: true } as any;

function country(code: string, enabled = true) {
    return { id: `country-${code}`, code, enabled, type: 'country' } as any;
}

function zone(id: string, members: any[]) {
    return { id, name: `Zone ${id}`, members } as any;
}

function channel(overrides: Record<string, unknown> = {}) {
    return {
        id: 1,
        code: 'default',
        token: 'default-token',
        defaultLanguageCode: LanguageCode.en,
        defaultCurrencyCode: CurrencyCode.USD,
        availableCurrencyCodes: [CurrencyCode.USD],
        defaultTaxZone: { id: 'z1' },
        defaultShippingZone: { id: 'z1' },
        ...overrides,
    } as any;
}

function input(overrides: Partial<ChannelReadinessInput> = {}): ChannelReadinessInput {
    const zones = [zone('z1', [country('DE')])];
    return {
        ctx,
        callerChannelId: 1,
        newContext: () => Promise.resolve(freshCtx),
        channel: channel(),
        allZones: zones,
        shippingZones: zones,
        ...overrides,
    };
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
    it('are namespaced, lower-case and unique, in every module that defines them', () => {
        // Every coded error exported by a check module, and the service's own, so a new one is covered.
        const modules = [
            channelTaxCountryModule,
            defaultZonesModule,
            paymentMethodsModule,
            pricesModule,
            searchIndexModule,
            shippingModule,
            shippingZonesModule,
            stockLocationsModule,
            superadminModule,
            taxInclusiveRatesModule,
            taxRateOverlapsModule,
            taxRatesModule,
            { checkFailed },
        ];
        const codes = modules.flatMap(module =>
            Object.values(module)
                .filter(
                    value =>
                        typeof value === 'object' && value !== null && 'code' in value && 'exit' in value,
                )
                .map(value => (value as { code: string }).code),
        );
        expect(codes.length).toBe(17);
        expect(codes.filter(code => !code.startsWith('store.') || !isValidErrorCode(code))).toEqual([]);
        expect(new Set(codes).size).toBe(codes.length);
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
        expect(findings[0]).toMatchObject({ severity: 'ERROR', channelId: 1, dashboardUrl: '/channels' });
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
    it('keeps zones with an enabled country and warns about the others', () => {
        const { shippingZones, findings } = findShippingZones([
            zone('z1', [country('DE'), country('AT', false)]),
            zone('z2', [country('FR', false)]),
            zone('z3', []),
        ]);
        expect(shippingZones.map(z => z.id)).toEqual(['z1']);
        expect(findings.map(f => [f.code, f.severity, f.zoneId])).toEqual([
            ['store.zone.no-enabled-country', 'WARNING', 'z2'],
            ['store.zone.no-enabled-country', 'WARNING', 'z3'],
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

/** Picks the zone that contains the country, like the address-based strategy. */
const byAddress = {
    determineTaxZone: (_ctx: unknown, zones: any[], ch: any, order?: any) =>
        zones.find(z => z.members.some((m: any) => m.code === order?.shippingAddress?.countryCode)) ??
        ch.defaultTaxZone,
} as any;

const defaultStrategy = {
    determineTaxZone: (_ctx: unknown, _zones: unknown, ch: any) => ch.defaultTaxZone,
} as any;

describe('checkTaxRates', () => {
    const fr = country('FR');
    const de = country('DE');
    const be = country('BE');
    const europe = zone('eu', [fr, de, be, country('NL', false), { ...country('BY'), type: 'province' }]);
    const shippingOnly = zone('pacific', [country('NZ')]);

    function connection(categoryIds: string[]) {
        return {
            getRepository: () => ({
                createQueryBuilder: () =>
                    queryBuilder({ getRawMany: categoryIds.map(taxCategoryId => ({ taxCategoryId })) }),
                find: () => Promise.resolve(categoryIds.map(id => ({ id, name: 'Standard' }))),
            }),
        } as any;
    }

    /** A rate exists only where `rates` says, keyed by "<zone id>" or "<country code>". */
    function taxRateService(rates: string[]) {
        const find = (target: { countryCode?: string; zone: { id: string } }) =>
            (target.countryCode && rates.includes(target.countryCode)) || rates.includes(target.zone.id)
                ? { id: 'rate' }
                : undefined;
        return {
            findApplicableTaxRate: vi.fn(
                (_ctx: unknown, target: { countryCode?: string; zone: { id: string } }) =>
                    Promise.resolve(find(target)),
            ),
            findIncludedTaxRate: vi.fn((_ctx: unknown, ch: any) =>
                Promise.resolve(
                    find({ countryCode: ch.taxCountryCode ?? undefined, zone: ch.defaultTaxZone }),
                ),
            ),
        } as any;
    }

    function taxInput(defaultTaxZone: unknown, shippingZones: any[]) {
        return input({
            channel: channel({ defaultTaxZone }),
            allZones: [europe, shippingOnly],
            shippingZones,
        });
    }

    it('checks the tax zone that the strategy picks for each country, and an order with no address', async () => {
        const service = taxRateService(['DE']);
        const findings = await checkTaxRates(taxInput(europe, [europe]), {
            connection: connection(['tc1']),
            taxRateService: service,
            taxZoneStrategy: byAddress,
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            code: 'store.tax.no-rate',
            zoneId: 'eu',
            taxCategoryId: 'tc1',
            channelId: 1,
        });
        // A disabled country and a province are not places an order ships to.
        expect(findings[0].message).toContain('orders to BE, FR and orders with no address yet');
        expect(findings[0].message).not.toMatch(/NL|BY/);
        expect(service.findApplicableTaxRate).toHaveBeenCalledTimes(4);
    });

    it('reports no gap for a shipping-only zone when the strategy always uses the default tax zone', async () => {
        const findings = await checkTaxRates(taxInput(europe, [europe, shippingOnly]), {
            connection: connection(['tc1']),
            taxRateService: taxRateService(['eu']),
            taxZoneStrategy: defaultStrategy,
        });
        expect(findings).toEqual([]);
    });

    it('reports a shipping-only zone when the strategy picks it by address', async () => {
        const findings = await checkTaxRates(taxInput(europe, [europe, shippingOnly]), {
            connection: connection(['tc1']),
            taxRateService: taxRateService(['eu']),
            taxZoneStrategy: byAddress,
        });
        expect(findings.map(f => [f.zoneId, f.message.includes('orders to NZ')])).toEqual([
            ['pacific', true],
        ]);
    });

    it('leaves the default tax zone of a tax-inclusive channel to checkTaxInclusiveRates', async () => {
        const findings = await checkTaxRates(
            input({
                channel: channel({ pricesIncludeTax: true, defaultTaxZone: europe }),
                allZones: [europe, shippingOnly],
                shippingZones: [europe, shippingOnly],
            }),
            {
                connection: connection(['tc1']),
                taxRateService: taxRateService([]),
                taxZoneStrategy: byAddress,
            },
        );
        expect(findings.map(f => f.zoneId)).toEqual(['pacific']);
    });

    it('looks the rate up for the tax country, as checkout does', async () => {
        // No order to FR gets the DE rate: the tax country only applies with no shipping country.
        const service = taxRateService(['DE']);
        const findings = await checkTaxRates(
            input({
                channel: channel({ defaultTaxZone: europe, taxCountryCode: 'DE' }),
                allZones: [europe],
                shippingZones: [europe],
            }),
            { connection: connection(['tc1']), taxRateService: service, taxZoneStrategy: byAddress },
        );
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain('orders to BE, FR');
        expect(findings[0].message).not.toContain('orders with no address yet');
    });

    it('applies no country rate where a reverse-charge strategy returns no tax country', async () => {
        const reverseCharge = { ...byAddress, determineTaxCountryCode: () => undefined };
        const findings = await checkTaxRates(taxInput(europe, [europe]), {
            connection: connection(['tc1']),
            taxRateService: taxRateService(['DE', 'FR', 'BE']),
            taxZoneStrategy: reverseCharge,
        });
        expect(findings).toHaveLength(1);
        expect(findings[0].message).toContain('orders to BE, DE, FR and orders with no address yet');
    });

    it('gives a billing-address strategy sample orders with a billing address', async () => {
        const byBilling = {
            ...byAddress,
            determineTaxCountryCode: (_ctx: unknown, _ch: unknown, _zone: unknown, order?: any) =>
                order && order.billingAddress.countryCode,
        };
        const findings = await checkTaxRates(taxInput(europe, [europe]), {
            connection: connection(['tc1']),
            taxRateService: taxRateService(['DE']),
            taxZoneStrategy: byBilling,
        });
        // The sample orders have no billing country, so no country rate applies to them.
        expect(findings[0].message).toContain('orders to BE, DE, FR and orders with no address yet');
    });

    it('reports the default tax zone of a tax-inclusive channel whose included rate is known', async () => {
        const findings = await checkTaxRates(
            input({
                channel: channel({ pricesIncludeTax: true, defaultTaxZone: europe, taxCountryCode: 'DE' }),
                allZones: [europe],
                shippingZones: [europe],
            }),
            {
                connection: connection(['tc1']),
                taxRateService: taxRateService(['DE']),
                taxZoneStrategy: byAddress,
            },
        );
        expect(findings.map(f => f.zoneId)).toEqual(['eu']);
    });

    it('reports nothing when the channel has no variants', async () => {
        expect(
            await checkTaxRates(input(), {
                connection: connection([]),
                taxRateService: {} as any,
                taxZoneStrategy: defaultStrategy,
            }),
        ).toEqual([]);
    });
});

describe('checkTaxInclusiveRates', () => {
    const europe = zone('eu', [country('DE'), country('FR'), country('BE'), country('NL', false)]);
    const pacific = zone('pacific', [country('NZ')]);

    function connection(categoryIds: string[]) {
        return {
            getRepository: () => ({
                createQueryBuilder: () =>
                    queryBuilder({ getRawMany: categoryIds.map(taxCategoryId => ({ taxCategoryId })) }),
                find: () => Promise.resolve(categoryIds.map(id => ({ id, name: `Category ${id}` }))),
                // Every code is a country but XX
                findOne: ({ where }: { where: { code: string } }) =>
                    Promise.resolve(where.code === 'XX' ? null : country(where.code)),
            }),
        } as any;
    }

    /**
     * Zone rates exist for the given tax category IDs, on any zone, and country rates for the given
     * country codes, for any tax category.
     */
    function taxRateService(categoriesWithZoneRate: string[], countriesWithRate: string[] = []) {
        const find = (countryCode: string | undefined, categoryId: string) =>
            countryCode && countriesWithRate.includes(countryCode)
                ? { id: 'country-rate', regionId: `country-${countryCode}` }
                : categoriesWithZoneRate.includes(categoryId)
                  ? { id: 'zone-rate', regionId: null }
                  : undefined;
        return {
            findApplicableTaxRate: vi.fn(
                (_ctx: unknown, target: { countryCode?: string }, categoryId: string) =>
                    Promise.resolve(find(target.countryCode, categoryId)),
            ),
            findIncludedTaxRate: vi.fn((_ctx: unknown, ch: any, categoryId: string) =>
                Promise.resolve(find(ch.taxCountryCode ?? undefined, categoryId)),
            ),
        } as any;
    }

    function inclusiveInput(overrides: Record<string, unknown> = {}, shippingZones = [europe]) {
        return input({
            channel: channel({ pricesIncludeTax: true, defaultTaxZone: { id: 'eu' }, ...overrides }),
            allZones: [europe, pacific],
            shippingZones,
        });
    }

    it('reports each tax category with no zone rate on the default tax zone, with a fix', async () => {
        const service = taxRateService(['tc1']);
        const findings = await checkTaxInclusiveRates(inclusiveInput(), {
            connection: connection(['tc1', 'tc2']),
            taxRateService: service,
            taxZoneStrategy: byAddress,
        });
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            code: 'store.tax.inclusive-rate-unknown',
            severity: 'ERROR',
            channelId: 1,
            zoneId: 'eu',
            taxCategoryId: 'tc2',
            dashboardUrl: '/tax-rates',
            fixes: [
                { path: ['admin_update_channel'], input: { id: 1, input: {} } },
                {
                    path: ['admin_create_tax_rate'],
                    input: {
                        input: {
                            name: 'Category tc2 Zone eu',
                            taxCategoryId: 'tc2',
                            target: { zoneId: 'eu' },
                        },
                    },
                },
            ],
        });
        expect(findings[0].message).toContain('Channel "default"');
        expect(findings[0].message).toContain('"Category tc2"');
        expect(findings[0].message).toContain('it has no tax country');
        // The lookup the price calculation makes
        expect(service.findIncludedTaxRate).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({ id: 1 }),
            'tc2',
        );
    });

    it('suggests a country of the default zone with a country rate as the tax country', async () => {
        const [finding] = await checkTaxInclusiveRates(inclusiveInput(), {
            connection: connection(['tc1']),
            taxRateService: taxRateService([], ['FR']),
            taxZoneStrategy: byAddress,
        });
        expect(finding.fixes.map(f => f.path[0])).toEqual(['admin_update_channel', 'admin_create_tax_rate']);
        expect(finding.fixes[0].input).toEqual({ id: 1, input: { taxCountryCode: 'FR' } });
    });

    it('leaves the tax country to the merchant when several countries of the zone have a rate', async () => {
        const [finding] = await checkTaxInclusiveRates(inclusiveInput(), {
            connection: connection(['tc1']),
            taxRateService: taxRateService([], ['BE', 'FR']),
            taxZoneStrategy: byAddress,
        });
        expect(finding.fixes[0]).toMatchObject({
            path: ['admin_update_channel'],
            input: { id: 1, input: {} },
        });
        expect(finding.fixes[0].description).toContain('normally your own');
    });

    it('ignores a disabled country when it suggests a tax country', async () => {
        // NL is disabled, so FR is the only candidate
        const [finding] = await checkTaxInclusiveRates(inclusiveInput(), {
            connection: connection(['tc1']),
            taxRateService: taxRateService([], ['FR', 'NL']),
            taxZoneStrategy: byAddress,
        });
        expect(finding.fixes[0].input).toEqual({ id: 1, input: { taxCountryCode: 'FR' } });
    });

    it('leaves a tax country that is not a country to checkChannelTaxCountry', async () => {
        expect(
            await checkTaxInclusiveRates(inclusiveInput({ taxCountryCode: 'XX' }), {
                connection: connection(['tc1']),
                taxRateService: taxRateService([]),
                taxZoneStrategy: byAddress,
            }),
        ).toEqual([]);
    });

    it('reports nothing when the tax country has a country rate, with no zone rate', async () => {
        expect(
            await checkTaxInclusiveRates(inclusiveInput({ taxCountryCode: 'DE' }), {
                connection: connection(['tc1']),
                taxRateService: taxRateService([], ['DE']),
                taxZoneStrategy: byAddress,
            }),
        ).toEqual([]);
    });

    it('offers a country rate for a tax country that has none', async () => {
        const [finding] = await checkTaxInclusiveRates(inclusiveInput({ taxCountryCode: 'BE' }), {
            connection: connection(['tc1']),
            taxRateService: taxRateService([], ['DE']),
            taxZoneStrategy: byAddress,
        });
        expect(finding.message).toContain('its tax country BE has no enabled country rate for it');
        expect(finding.fixes[0]).toMatchObject({
            path: ['admin_create_tax_rate'],
            input: { input: { taxCategoryId: 'tc1', target: { countryCode: 'BE' } } },
        });
        // Orders with no address get BE as tax country, which has no rate.
        expect(finding.message).toContain('orders with no address yet and orders to BE, FR are taxed at 0%');
    });

    it('names the orders in the default zone that are taxed at 0%', async () => {
        const [finding] = await checkTaxInclusiveRates(inclusiveInput(), {
            connection: connection(['tc1']),
            taxRateService: taxRateService([], ['DE']),
            taxZoneStrategy: byAddress,
        });
        // DE has a country rate, and NL is disabled.
        expect(finding.message).toContain(
            'In "Zone eu", orders with no address yet and orders to BE, FR are taxed at 0%.',
        );
    });

    it('names the effect outside the default zone only when the channel ships outside it', async () => {
        const inside = await checkTaxInclusiveRates(inclusiveInput(), {
            connection: connection(['tc1']),
            taxRateService: taxRateService([]),
            taxZoneStrategy: byAddress,
        });
        expect(inside[0].message).not.toContain('on top of the full entered price');
        const outside = await checkTaxInclusiveRates(inclusiveInput({}, [europe, pacific]), {
            connection: connection(['tc1']),
            taxRateService: taxRateService([]),
            taxZoneStrategy: byAddress,
        });
        expect(outside[0].message).toContain(
            "Orders taxed in another zone pay that zone's tax on top of the full entered price.",
        );
    });

    it('names the shipping countries that the strategy taxes in the default zone', async () => {
        const [finding] = await checkTaxInclusiveRates(inclusiveInput({}, [europe, pacific]), {
            connection: connection(['tc1']),
            taxRateService: taxRateService([], ['DE']),
            taxZoneStrategy: defaultStrategy,
        });
        // Every order gets the default tax zone, so NZ is taxed at 0% there, and no order is taxed
        // in another zone.
        expect(finding.message).toContain(
            'In "Zone eu", orders with no address yet and orders to BE, FR, NZ are taxed at 0%.',
        );
        expect(finding.message).not.toContain('on top of the full entered price');
    });

    it('reports nothing for a channel whose prices exclude tax', async () => {
        const service = taxRateService([]);
        expect(
            await checkTaxInclusiveRates(input({ channel: channel({ pricesIncludeTax: false }) }), {
                connection: connection(['tc1']),
                taxRateService: service,
                taxZoneStrategy: byAddress,
            }),
        ).toEqual([]);
        expect(service.findIncludedTaxRate).not.toHaveBeenCalled();
    });

    it('leaves a channel with no default tax zone to the default-zones check', async () => {
        expect(
            await checkTaxInclusiveRates(inclusiveInput({ defaultTaxZone: undefined }), {
                connection: connection(['tc1']),
                taxRateService: taxRateService([]),
                taxZoneStrategy: byAddress,
            }),
        ).toEqual([]);
    });

    it('reports nothing when the channel has no variants', async () => {
        expect(
            await checkTaxInclusiveRates(inclusiveInput(), {
                connection: connection([]),
                taxRateService: taxRateService([]),
                taxZoneStrategy: byAddress,
            }),
        ).toEqual([]);
    });
});

describe('checkChannelTaxCountry', () => {
    const europe = zone('eu', [country('DE'), country('FR')]);

    function connection(countryCodes: string[]) {
        return {
            getRepository: () => ({
                findOne: ({ where }: { where: { code: string } }) =>
                    Promise.resolve(countryCodes.includes(where.code) ? country(where.code) : null),
            }),
        } as any;
    }

    function taxCountryInput(taxCountryCode: string | null) {
        return input({
            channel: channel({ defaultTaxZone: { id: 'eu' }, taxCountryCode }),
            allZones: [europe],
        });
    }

    it('reports nothing for a tax country in the default tax zone, or none', async () => {
        expect(await checkChannelTaxCountry(taxCountryInput('DE'), connection(['DE']))).toEqual([]);
        expect(await checkChannelTaxCountry(taxCountryInput(null), connection([]))).toEqual([]);
    });

    it('warns about a tax country outside the default tax zone', async () => {
        const findings = await checkChannelTaxCountry(taxCountryInput('CH'), connection(['CH']));
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            code: 'store.channel.tax-country-outside-default-zone',
            severity: 'WARNING',
            channelId: 1,
            zoneId: 'eu',
            dashboardUrl: '/channels',
            fixes: [{ path: ['admin_update_zone'], input: { id: 'eu' } }],
        });
    });

    it('leaves a channel whose default tax zone is missing to the default-zones check', async () => {
        const missingZone = input({
            channel: channel({ defaultTaxZone: { id: 'gone' }, taxCountryCode: 'CH' }),
            allZones: [europe],
        });
        expect(await checkChannelTaxCountry(missingZone, connection(['CH']))).toEqual([]);
    });

    it('describes the effect for prices that include tax, or not', async () => {
        const [net] = await checkChannelTaxCountry(taxCountryInput('CH'), connection(['CH']));
        expect(net.message).toContain('orders with no address are taxed at the zone rate');
        const inclusive = input({
            channel: channel({ defaultTaxZone: { id: 'eu' }, taxCountryCode: 'CH', pricesIncludeTax: true }),
            allZones: [europe],
        });
        const [gross] = await checkChannelTaxCountry(inclusive, connection(['CH']));
        expect(gross.message).toContain('the entered prices are split at the zone rate');
    });

    it('reports a tax country that is not the code of a country', async () => {
        const findings = await checkChannelTaxCountry(taxCountryInput('XX'), connection(['DE']));
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            code: 'store.channel.tax-country-unknown',
            severity: 'ERROR',
            fixes: [{ path: ['admin_update_channel'], input: { id: 1, input: { taxCountryCode: null } } }],
        });
    });
});

describe('checkTaxRateOverlaps', () => {
    const taxRateService = {
        findOverlappingZoneRates: () =>
            Promise.resolve([
                { countryCode: 'AT', taxCategoryId: 'tc1', taxRates: [{ name: 'A' }, { name: 'B' }] },
            ]),
    } as any;

    it('reports each overlap as a warning with a country-rate fix', async () => {
        const [finding] = await checkTaxRateOverlaps(ctx, taxRateService, new AddressBasedTaxZoneStrategy());
        expect(finding).toMatchObject({
            code: 'store.tax.ambiguous-zone-rates',
            severity: 'WARNING',
            countryCode: 'AT',
            taxCategoryId: 'tc1',
        });
        expect(finding.fixes[0].input).toMatchObject({ input: { target: { countryCode: 'AT' } } });
    });

    it('reports nothing with the default strategy, which never picks a zone by address', async () => {
        expect(await checkTaxRateOverlaps(ctx, taxRateService, new DefaultTaxZoneStrategy())).toEqual([]);
    });
});

describe('checkPrices', () => {
    it('reports each channel currency in which some variants have no price', async () => {
        const counts: Record<string, number> = { USD: 3, EUR: 1 };
        let currency = '';
        const builder: any = new Proxy(
            {},
            {
                get: (_target, prop) => {
                    if (prop === 'getCount') return () => Promise.resolve(3);
                    if (prop === 'getRawOne')
                        return () => Promise.resolve({ count: String(counts[currency]) });
                    if (prop === 'andWhere')
                        return (_sql: string, params?: { currencyCode?: string }) => {
                            currency = params?.currencyCode ?? currency;
                            return builder;
                        };
                    return () => builder;
                },
            },
        );
        const connection = { getRepository: () => ({ createQueryBuilder: () => builder }) } as any;
        const findings = await checkPrices(
            input({ channel: channel({ availableCurrencyCodes: [CurrencyCode.USD, CurrencyCode.EUR] }) }),
            connection,
        );
        expect(findings).toEqual([
            expect.objectContaining({
                code: 'store.channel.missing-prices',
                severity: 'ERROR',
                channelId: 1,
            }),
        ]);
        expect(findings[0].message).toMatch(/^2 product variant\(s\) .* in EUR/);
    });
});

describe('checkSearchIndex', () => {
    function connection(hasIndex: boolean, variants: number, indexed: number) {
        let call = 0;
        return {
            rawConnection: { hasMetadata: () => hasIndex },
            getRepository: () => ({
                createQueryBuilder: () => queryBuilder({ getCount: call++ === 0 ? variants : indexed }),
            }),
        } as any;
    }

    it('warns when the index holds fewer items than the channel has variants', async () => {
        const [finding] = await checkSearchIndex(input(), connection(true, 5, 2));
        expect(finding).toMatchObject({ code: 'store.search.index-incomplete', severity: 'WARNING' });
        expect(finding.message).toContain('holds 2 of its 5');
    });

    it('reports nothing for a full index, or without the default search plugin', async () => {
        expect(await checkSearchIndex(input(), connection(true, 5, 5))).toEqual([]);
        expect(await checkSearchIndex(input(), connection(false, 5, 0))).toEqual([]);
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
        const findings = await checkShipping(input(), services({ methods: 0, variant: { id: 'v1' } }));
        expect(findings.map(f => f.code)).toEqual(['store.channel.no-shipping-method']);
    });

    it('reports a channel with nothing to sell and skips the sample orders', async () => {
        const deps = services({ variant: undefined });
        const findings = await checkShipping(input(), deps);
        expect(findings.map(f => f.code)).toEqual(['store.channel.no-sellable-variant']);
        expect(deps.orderTestingService.testEligibleShippingMethods).not.toHaveBeenCalled();
    });

    it('reports a missing shipping method and nothing to sell together', async () => {
        const findings = await checkShipping(input(), services({ methods: 0, variant: undefined }));
        expect(findings.map(f => f.code)).toEqual([
            'store.channel.no-shipping-method',
            'store.channel.no-sellable-variant',
        ]);
    });

    it("starts the fixes by switching channel when the finding is not about the caller's channel", async () => {
        const [other] = await checkShipping(
            input({ callerChannelId: 2 }),
            services({ methods: 0, variant: { id: 'v1' } }),
        );
        expect(other.fixes.map(fix => fix.path[0])).toEqual([
            'admin_set_active_channel',
            'admin_list_shipping_options',
        ]);
        expect(other.fixes[0].input).toEqual({ channelToken: 'default-token' });
        const [same] = await checkShipping(input(), services({ methods: 0, variant: { id: 'v1' } }));
        expect(same.fixes.map(fix => fix.path[0])).toEqual(['admin_list_shipping_options']);
    });

    it('prices one sample order per zone and reports the zones with no eligible method', async () => {
        const deps = services({ variant: { id: 'v1' }, quotes: [] });
        const findings = await checkShipping(
            input({ shippingZones: [zone('z1', [country('FR'), country('DE')])] }),
            deps,
        );
        expect(deps.orderTestingService.testEligibleShippingMethods).toHaveBeenCalledWith(freshCtx, {
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
        expect(finding).toMatchObject({ code: 'store.channel.no-stock-location', severity: 'ERROR' });
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
            expect.objectContaining({ code: 'store.auth.default-superadmin-password', severity: 'WARNING' }),
        ]);
    });

    it('reports nothing once the password is changed, or when there is no superadmin login', async () => {
        expect(await checkSuperadminCredentials(ctx, deps('hash', false).services)).toEqual([]);
        expect(await checkSuperadminCredentials(ctx, deps(undefined, true).services)).toEqual([]);
    });
});
