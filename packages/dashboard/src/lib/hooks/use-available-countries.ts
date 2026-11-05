import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';

export const availableCountriesQueryKey = ['availableCountries'];

const availableCountriesDocument = graphql(`
    query GetAvailableCountries {
        countries(options: { sort: { name: ASC }, filter: { enabled: { eq: true } } }) {
            items {
                id
                code
                name
            }
        }
    }
`);

/**
 * @description
 * Fetches the enabled countries, sorted by name, for the address form country
 * dropdowns. The country detail page and the country bulk actions invalidate
 * `availableCountriesQueryKey` after a mutation, so any new mutation that
 * changes a country must invalidate it too or the dropdown will serve a stale
 * list for up to the `staleTime` below.
 *
 * No `take` is passed. The server then returns up to `adminListQueryLimit`,
 * which defaults to 1000 and covers the 248 countries Vendure ships. Passing an
 * explicit `take` above that limit is rejected with `error.list-query-limit-exceeded`.
 */
export function useAvailableCountries() {
    return useQuery({
        queryKey: availableCountriesQueryKey,
        queryFn: () => api.query(availableCountriesDocument),
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
