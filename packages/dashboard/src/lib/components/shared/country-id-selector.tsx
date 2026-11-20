import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { useAvailableCountries } from '@/vdb/hooks/use-available-countries.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Skeleton } from '../ui/skeleton.js';

export interface CountryIdSelectorProps {
    value: string | undefined;
    onChange: (value: string) => void;
}

/**
 * @description
 * Selects a single enabled country and reports its ID. {@link AddressCountrySelect} reports the
 * country code instead, and {@link CountrySelector} adds countries to a list.
 *
 * It uses the same query as {@link AddressCountrySelect}, which country mutations invalidate.
 */
export function CountryIdSelector({ value, onChange }: Readonly<CountryIdSelectorProps>) {
    const { t } = useLingui();
    const { data, isPending } = useAvailableCountries();

    if (isPending) {
        return <Skeleton className="h-9 w-full" />;
    }

    const countries = data?.countries.items ?? [];
    return (
        <Select
            items={Object.fromEntries(countries.map(country => [country.id, country.name]))}
            value={value ?? ''}
            onValueChange={newValue => newValue && onChange(newValue)}
        >
            <SelectTrigger aria-label={t`Country`}>
                <SelectValue placeholder={<Trans>Select a country</Trans>} />
            </SelectTrigger>
            <SelectContent>
                {countries.map(country => (
                    <SelectItem key={country.id} value={country.id}>
                        {country.name} ({country.code})
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
