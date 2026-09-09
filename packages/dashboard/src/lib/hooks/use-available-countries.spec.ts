import { api } from '@/vdb/graphql/api.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAvailableCountries } from './use-available-countries.js';

vi.mock('@/vdb/graphql/api.js', () => ({
    api: {
        query: vi.fn(),
    },
}));

describe('fetchAvailableCountries', () => {
    const query = vi.mocked(api.query);

    beforeEach(() => {
        query.mockReset();
    });

    it('returns the countries from a single list query', async () => {
        const countries = [
            { id: '1', code: 'AT', name: 'Austria' },
            { id: '2', code: 'CA', name: 'Canada' },
        ];
        query.mockResolvedValueOnce({ countries: { items: countries } });

        const result = await fetchAvailableCountries();

        expect(result).toEqual(countries);
        expect(query).toHaveBeenCalledTimes(1);
    });
});
