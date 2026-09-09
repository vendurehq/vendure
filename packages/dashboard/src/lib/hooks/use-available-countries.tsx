import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, type ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
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

type AvailableCountry = ResultOf<typeof availableCountriesDocument>['countries']['items'][number];

export async function fetchAvailableCountries(): Promise<AvailableCountry[]> {
    const result = await api.query(availableCountriesDocument);
    return result.countries.items;
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
        queryFn: fetchAvailableCountries,
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}

interface CountrySelectProps {
    value?: string;
    onValueChange: (value: string) => void;
}

export function CountrySelect({ value, onValueChange }: Readonly<CountrySelectProps>) {
    const { data: countries = [], isLoading } = useAvailableCountries();

    return (
        <Select
            items={Object.fromEntries(countries.map(country => [country.code, country.name]))}
            onValueChange={newValue => onValueChange(newValue ?? '')}
            value={value ?? ''}
            disabled={isLoading}
        >
            <SelectTrigger>
                <SelectValue>
                    {selectedValue =>
                        countries.find(country => country.code === selectedValue)?.name ?? (
                            <Trans>Select a country</Trans>
                        )
                    }
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                {countries.map(country => (
                    <SelectItem key={country.code} value={country.code}>
                        {country.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
