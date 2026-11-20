import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common/error/errors';
import { Country } from '../../entity/region/country.entity';
import { Province } from '../../entity/region/province.entity';
import { Region } from '../../entity/region/region.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';
import { Zone } from '../../entity/zone/zone.entity';

import { TaxRateService } from './tax-rate.service';

async function makeService(
    rates: TaxRate[],
    options: { regions?: Array<Country | Province>; zones?: Zone[] } = {},
) {
    const repositories = new Map<unknown, unknown>([
        [TaxRate, { find: () => Promise.resolve(rates.filter(r => r.enabled)) }],
        [Zone, { find: () => Promise.resolve(options.zones ?? []) }],
        [
            Region,
            {
                findOne: ({ where }: any) =>
                    Promise.resolve(options.regions?.find(r => r.id === where.id) ?? null),
            },
        ],
    ]);
    const connection: any = {
        getRepository: (_ctx: unknown, type: unknown) => repositories.get(type),
        getEntityOrThrow: (_ctx: any, _type: any, id: any) => Promise.resolve({ id }),
    };
    const configService: any = { entityOptions: { taxRateCacheTtl: 30_000 } };
    const service = new TaxRateService(connection, {} as any, {} as any, configService, {} as any);
    await service.initTaxRates();
    return service;
}

const ctx = RequestContext.empty();
const de = new Country({ id: 'DE1', code: 'DE', type: 'country' });
const fr = new Country({ id: 'FR1', code: 'FR', type: 'country' });
const zoneRate = new TaxRate({ id: 1, name: 'eu', enabled: true, value: 22, categoryId: 1, zoneId: 5 });
const deRate = new TaxRate({
    id: 2,
    name: 'de',
    enabled: true,
    value: 19,
    categoryId: 1,
    zoneId: null,
    region: de,
    regionId: 'DE1',
});
const frRate = new TaxRate({
    id: 3,
    name: 'fr',
    enabled: true,
    value: 20,
    categoryId: 1,
    zoneId: null,
    region: fr,
    regionId: 'FR1',
});

describe('TaxRateService.getApplicableTaxRate()', () => {
    it('a country rate beats a zone rate', async () => {
        const service = await makeService([zoneRate, deRate, frRate]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'DE', zone: 5 }, 1)).value).toBe(19);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'FR', zone: 5 }, 1)).value).toBe(20);
    });

    it('a zone rate is used when the country has no rate', async () => {
        const service = await makeService([zoneRate, deRate]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'IT', zone: 5 }, 1)).value).toBe(22);
        expect((await service.getApplicableTaxRate(ctx, { zone: 5 }, 1)).value).toBe(22);
    });

    it('the default rate is used when nothing matches', async () => {
        const service = await makeService([deRate]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'IT', zone: 5 }, 1)).value).toBe(0);
    });

    it('a country rate for another tax category does not match', async () => {
        const service = await makeService([zoneRate, deRate]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'DE', zone: 5 }, 2)).value).toBe(0);
    });

    it('disabled rates are skipped', async () => {
        const disabled = new TaxRate({ ...deRate, enabled: false, region: de });
        const service = await makeService([zoneRate, disabled]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'DE', zone: 5 }, 1)).value).toBe(22);
    });

    it('the zone-only signature still works', async () => {
        const service = await makeService([zoneRate, deRate]);
        expect((await service.getApplicableTaxRate(ctx, 5, 1)).value).toBe(22);
    });
    it('the first rate wins when two rates have the same target', async () => {
        const second = new TaxRate({ ...zoneRate, id: 9, value: 7 });
        const service = await makeService([zoneRate, second]);
        expect((await service.getApplicableTaxRate(ctx, 5, 1)).value).toBe(22);
    });

    it('matches ids of either type, and entities as well as ids', async () => {
        const service = await makeService([zoneRate, deRate]);
        const zone = new Zone({ id: '5' });
        expect((await service.getApplicableTaxRate(ctx, zone, '1')).value).toBe(22);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'DE', zone }, '1')).value).toBe(19);
    });
});

describe('TaxRateService.findOverlappingZoneRates()', () => {
    const it_ = new Country({ id: 'IT1', code: 'IT', type: 'country' });
    const eu = new Zone({ id: 5, name: 'eu', members: [de, fr, it_] });
    const dach = new Zone({ id: 6, name: 'dach', members: [de] });
    const dachRate = new TaxRate({ id: 4, name: 'dach', enabled: true, value: 21, categoryId: 1, zoneId: 6 });

    it('returns a country that two zone rates match', async () => {
        const service = await makeService([zoneRate, dachRate], { zones: [eu, dach] });
        const result = await service.findOverlappingZoneRates(ctx);
        expect(result.map(r => [r.countryCode, r.taxRates.map(t => t.name)])).toEqual([
            ['DE', ['eu', 'dach']],
        ]);
    });

    it('leaves out a country that has a country rate', async () => {
        const service = await makeService([zoneRate, dachRate, deRate], { zones: [eu, dach] });
        expect(await service.findOverlappingZoneRates(ctx)).toEqual([]);
    });

    it('leaves out zone rates of different tax categories', async () => {
        const otherCategory = new TaxRate({ ...dachRate, categoryId: 2 });
        const service = await makeService([zoneRate, otherCategory], { zones: [eu, dach] });
        expect(await service.findOverlappingZoneRates(ctx)).toEqual([]);
    });
});

describe('TaxRateService target validation', () => {
    const province = new Province({ id: 'P1', code: 'BY', type: 'province' });
    const base = { name: 'x', enabled: true, value: 1, categoryId: 1 };

    it('rejects both targets', async () => {
        const service = await makeService([], { regions: [de] });
        await expect(service.create(ctx, { ...base, zoneId: 5, regionId: 'DE1' })).rejects.toBeInstanceOf(
            UserInputError,
        );
    });

    it('rejects neither target', async () => {
        const service = await makeService([], { regions: [de] });
        await expect(service.create(ctx, base)).rejects.toBeInstanceOf(UserInputError);
    });

    it('rejects a region that is not a country', async () => {
        const service = await makeService([], { regions: [province] });
        await expect(service.create(ctx, { ...base, regionId: 'P1' })).rejects.toBeInstanceOf(UserInputError);
    });
});
