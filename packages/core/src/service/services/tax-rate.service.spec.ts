import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { UserInputError } from '../../common/error/errors';
import { Country } from '../../entity/region/country.entity';
import { Province } from '../../entity/region/province.entity';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';

import { TaxRateService } from './tax-rate.service';

function makeService(rates: TaxRate[], regions: Array<Country | Province> = []) {
    const connection: any = {
        getRepository: () => ({
            findOne: async ({ where }: any) => regions.find(r => r.id === where.id) ?? null,
        }),
        getEntityOrThrow: async (_ctx: any, _type: any, id: any) => ({ id }),
    };
    const service = new TaxRateService(connection, {} as any, {} as any, {} as any, {} as any);
    (service as any).activeTaxRates = { value: async () => rates.filter(r => r.enabled) };
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
        const service = makeService([zoneRate, deRate, frRate]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'DE', zone: 5 }, 1)).value).toBe(19);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'FR', zone: 5 }, 1)).value).toBe(20);
    });

    it('a zone rate is used when the country has no rate', async () => {
        const service = makeService([zoneRate, deRate]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'IT', zone: 5 }, 1)).value).toBe(22);
        expect((await service.getApplicableTaxRate(ctx, { zone: 5 }, 1)).value).toBe(22);
    });

    it('the default rate is used when nothing matches', async () => {
        const service = makeService([deRate]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'IT', zone: 5 }, 1)).value).toBe(0);
    });

    it('a country rate for another tax category does not match', async () => {
        const service = makeService([zoneRate, deRate]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'DE', zone: 5 }, 2)).value).toBe(0);
    });

    it('disabled rates are skipped', async () => {
        const disabled = new TaxRate({ ...deRate, enabled: false, region: de });
        const service = makeService([zoneRate, disabled]);
        expect((await service.getApplicableTaxRate(ctx, { countryCode: 'DE', zone: 5 }, 1)).value).toBe(22);
    });

    it('the zone-only signature still works', async () => {
        const service = makeService([zoneRate, deRate]);
        expect((await service.getApplicableTaxRate(ctx, 5, 1)).value).toBe(22);
    });
});

describe('TaxRateService target validation', () => {
    const province = new Province({ id: 'P1', code: 'BY', type: 'province' });
    const base = { name: 'x', enabled: true, value: 1, categoryId: 1 };

    it('rejects both targets', async () => {
        const service = makeService([], [de]);
        await expect(service.create(ctx, { ...base, zoneId: 5, regionId: 'DE1' })).rejects.toBeInstanceOf(
            UserInputError,
        );
    });

    it('rejects neither target', async () => {
        const service = makeService([], [de]);
        await expect(service.create(ctx, base)).rejects.toBeInstanceOf(UserInputError);
    });

    it('rejects a region that is not a country', async () => {
        const service = makeService([], [province]);
        await expect(service.create(ctx, { ...base, regionId: 'P1' })).rejects.toBeInstanceOf(UserInputError);
    });
});
