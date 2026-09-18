import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';

export const availableCountriesQueryKey = ['availableCountries'];

const availableCountriesDocument = graphql(`
    query GetAvailableCountries {
        countries(options: { filter: { enabled: { eq: true } } }) {
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
        queryFn: () => api.query(availableCountriesDocument),
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
