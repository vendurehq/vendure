import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/vdb/components/ui/select.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '../ui/skeleton.js';

const countriesDocument = graphql(`
    query CountryIdSelectorCountries($options: CountryListOptions) {
        countries(options: $options) {
            items {
                id
                name
                code
            }
        }
    }
`);

export interface CountryIdSelectorProps {
    value: string | undefined;
    onChange: (value: string) => void;
}

/**
 * Selects a single country and reports its ID. Use `CountrySelector` to pick a country
 * as an object, for example when adding countries to a list.
 */
export function CountryIdSelector({ value, onChange }: Readonly<CountryIdSelectorProps>) {
    const { data, isLoading, isPending } = useQuery({
        queryKey: ['countries', 'id-selector'],
        queryFn: () =>
            api.query(countriesDocument, {
                options: {
                    take: 1000,
                    sort: { name: 'ASC' },
                },
            }),
    });

    if (isLoading || isPending) {
        return <Skeleton className="h-10 w-full" />;
    }

    const countries = data?.countries.items ?? [];
    return (
        <Select
            items={Object.fromEntries(countries.map(c => [c.id, c.name]))}
            value={value ?? ''}
            onValueChange={newValue => newValue && onChange(newValue)}
        >
            <SelectTrigger>
                <SelectValue placeholder={<Trans>Select a country</Trans>}>
                    {(val: string) => countries.find(c => c.id === val)?.name}
                </SelectValue>
            </SelectTrigger>
            <SelectContent>
                <SelectGroup>
                    {countries.map(country => (
                        <SelectItem key={country.id} value={country.id}>
                            {country.name} ({country.code})
                        </SelectItem>
                    ))}
                </SelectGroup>
            </SelectContent>
        </Select>
    );
}
