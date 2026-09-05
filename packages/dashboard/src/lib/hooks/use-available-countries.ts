import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';

export const availableCountriesQueryKey = ['availableCountries'];

const availableCountriesDocument = graphql(`
    query GetAvailableCountries($options: CountryListOptions) {
        countries(options: $options) {
            items {
                id
                code
                name
            }
            totalItems
        }
    }
`);

/**
 * Fetches all enabled countries across every server-limited page.
 */
export async function fetchAllAvailableCountries() {
    const items: Array<{ id: string; code: string; name: string }> = [];
    let totalItems = 0;

    do {
        // Omitting `take` lets the server apply its configured admin list query limit.
        const result = await api.query(availableCountriesDocument, {
            options: {
                skip: items.length,
                sort: { name: 'ASC' },
                filter: { enabled: { eq: true } },
            },
        });
        const page = result.countries.items;

        if (page.length === 0) {
            break;
        }
        items.push(...page);
        totalItems = result.countries.totalItems;
    } while (items.length < totalItems);

    return { countries: { items, totalItems } };
}

/**
 * @description
 * Fetches the enabled countries (sorted by name) used to populate country
 * dropdowns in the address forms. Shared so the query is defined once and its
 * cache is reused across the customer address form and the shipping-method test
 * address form. A modest `staleTime` avoids refetching the full list every time
 * a dialog that renders it mounts; the country admin pages invalidate
 * `availableCountriesQueryKey` after mutations so the list stays fresh.
 */
export function useAvailableCountries() {
    return useQuery({
        queryKey: availableCountriesQueryKey,
        queryFn: fetchAllAvailableCountries,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
