import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';
import { ListQueryBuilder } from '../helpers/list-query-builder/list-query-builder';

import { TaxRateService } from './tax-rate.service';

function createService() {
    const build = vi.fn().mockReturnValue({ getManyAndCount: () => Promise.resolve([[], 0]) });
    const listQueryBuilder = {
        build,
        filterObjectHasProperty: (filter: any, property: string) => !!filter && property in filter,
    } as unknown as ListQueryBuilder;
    const service = new TaxRateService({} as any, {} as any, listQueryBuilder, {} as any, {} as any);
    return { service, build };
}

describe('TaxRateService.findAll', () => {
    it('maps a categoryId filter to the category relation', async () => {
        const { service, build } = createService();

        await service.findAll(RequestContext.empty(), { filter: { categoryId: { eq: 'T_1' } } });

        const [entity, , extendedOptions] = build.mock.calls[0];
        expect(entity).toBe(TaxRate);
        expect(extendedOptions.relations).toContain('category');
        expect(extendedOptions.customPropertyMap).toEqual({ categoryId: 'category.id' });
    });

    it('maps zoneId and categoryId filters independently', async () => {
        const { service, build } = createService();

        await service.findAll(RequestContext.empty(), {
            filter: { zoneId: { eq: 'T_1' }, categoryId: { eq: 'T_2' } },
        });

        expect(build.mock.calls[0][2].customPropertyMap).toEqual({
            zoneId: 'zone.id',
            categoryId: 'category.id',
        });
    });
});
