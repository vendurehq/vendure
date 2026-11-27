import { LanguageCode } from '@vendure/common/lib/generated-types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InitialData } from '../../types';

import { Populator } from './populator';

describe('Populator', () => {
    let taxRateCreate: ReturnType<typeof vi.fn>;
    let taxCategoryCreate: ReturnType<typeof vi.fn>;
    let populator: Populator;

    beforeEach(() => {
        let nextZoneId = 1;
        taxRateCreate = vi.fn().mockResolvedValue({});
        taxCategoryCreate = vi.fn().mockImplementation((_ctx, input) => ({ id: `cat-${input.name}` }));
        const countryService = { create: vi.fn().mockImplementation((_ctx, input) => ({ id: input.code })) };
        const zoneService = {
            getAllWithMembers: vi.fn().mockResolvedValue([]),
            create: vi.fn().mockImplementation((_ctx, input) => ({ id: nextZoneId++, name: input.name })),
            addMembersToZone: vi.fn(),
        };
        const channelService = { getDefaultChannel: vi.fn().mockResolvedValue({ id: 1 }), update: vi.fn() };
        const configService = { authOptions: { superadminCredentials: { identifier: 'superadmin' } } };
        const connection = {
            rawConnection: { getRepository: () => ({ findOne: vi.fn().mockResolvedValue(undefined) }) },
        };
        const requestContextService = { create: vi.fn().mockResolvedValue({ languageCode: LanguageCode.en }) };
        populator = new Populator(
            countryService as any,
            zoneService as any,
            channelService as any,
            { create: taxRateCreate } as any,
            { create: taxCategoryCreate } as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            configService as any,
            connection as any,
            requestContextService as any,
        );
    });

    function initialData(taxRates: InitialData['taxRates']): InitialData {
        return {
            defaultLanguage: LanguageCode.en,
            defaultZone: 'Germany',
            countries: [
                { name: 'Germany', code: 'DE', zone: 'Germany' },
                { name: 'France', code: 'FR', zone: 'France' },
                { name: 'Hungary', code: 'HU', zone: 'Hungary' },
                { name: 'Austria', code: 'AT', zone: 'Austria' },
            ],
            taxRates,
            shippingMethods: [],
            paymentMethods: [],
            collections: [],
        };
    }

    function createdRates() {
        return Object.fromEntries(taxRateCreate.mock.calls.map(([, input]) => [input.name, input.value]));
    }

    it('gives every zone the same percentage when zones is not set', async () => {
        await populator.populateInitialData(initialData([{ name: 'Standard Tax', percentage: 19 }]));

        expect(createdRates()).toEqual({
            'Standard Tax Germany': 19,
            'Standard Tax France': 19,
            'Standard Tax Hungary': 19,
            'Standard Tax Austria': 19,
        });
    });

    it('uses the zones override for listed zones and percentage for the rest', async () => {
        await populator.populateInitialData(
            initialData([
                { name: 'Standard Tax', percentage: 19, zones: { France: 20, Hungary: 27 } },
                { name: 'Zero Tax', percentage: 0 },
            ]),
        );

        expect(taxCategoryCreate).toHaveBeenCalledTimes(2);
        expect(createdRates()).toEqual({
            'Standard Tax Germany': 19,
            'Standard Tax France': 20,
            'Standard Tax Hungary': 27,
            'Standard Tax Austria': 19,
            'Zero Tax Germany': 0,
            'Zero Tax France': 0,
            'Zero Tax Hungary': 0,
            'Zero Tax Austria': 0,
        });
    });

    it('applies a zero override instead of falling back to percentage', async () => {
        await populator.populateInitialData(
            initialData([{ name: 'Reduced Tax', percentage: 7, zones: { Austria: 0 } }]),
        );

        expect(createdRates()['Reduced Tax Austria']).toBe(0);
        expect(createdRates()['Reduced Tax Germany']).toBe(7);
    });

    it('throws before creating tax rates when a zones key names an unknown zone', async () => {
        await expect(
            populator.populateInitialData(
                initialData([{ name: 'Standard Tax', percentage: 19, zones: { France: 20, Narnia: 5 } }]),
            ),
        ).rejects.toThrow('The taxRates entry "Standard Tax" sets a rate for unknown zones: Narnia.');

        expect(taxCategoryCreate).not.toHaveBeenCalled();
        expect(taxRateCreate).not.toHaveBeenCalled();
    });
});
