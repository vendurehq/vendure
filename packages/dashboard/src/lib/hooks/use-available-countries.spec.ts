import { api } from '@/vdb/graphql/api.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchAllAvailableCountries } from './use-available-countries.js';

vi.mock('@/vdb/graphql/api.js', () => ({
    api: {
        query: vi.fn(),
    },
}));

describe('fetchAllAvailableCountries', () => {
    const query = vi.mocked(api.query);

    beforeEach(() => {
        query.mockReset();
    });

    it('loads every page without exceeding the configured list query limit', async () => {
        query
            .mockResolvedValueOnce({
                countries: {
                    items: [
                        { id: '1', code: 'AT', name: 'Austria' },
                        { id: '2', code: 'CA', name: 'Canada' },
                    ],
                    totalItems: 3,
                },
            })
            .mockResolvedValueOnce({
                countries: {
                    items: [{ id: '3', code: 'US', name: 'United States' }],
                    totalItems: 3,
                },
            });

        const result = await fetchAllAvailableCountries();

        expect(result.countries.items.map(country => country.code)).toEqual(['AT', 'CA', 'US']);
        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls.map(([, variables]) => variables)).toEqual([
            {
                options: {
                    skip: 0,
                    sort: { name: 'ASC' },
                    filter: { enabled: { eq: true } },
                },
            },
            {
                options: {
                    skip: 2,
                    sort: { name: 'ASC' },
                    filter: { enabled: { eq: true } },
                },
            },
        ]);
    });

    it('stops if the API returns an empty page', async () => {
        query.mockResolvedValueOnce({
            countries: {
                items: [],
                totalItems: 1,
            },
        });

        const result = await fetchAllAvailableCountries();

        expect(result).toEqual({ countries: { items: [], totalItems: 0 } });
        expect(query).toHaveBeenCalledTimes(1);
    });
});
