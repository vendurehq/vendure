import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { useAvailableCountries } from '@/vdb/hooks/use-available-countries.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Skeleton } from '../ui/skeleton.js';

export interface AddressCountrySelectProps {
    value: string | undefined;
    onChange: (value: string) => void;
}

/**
 * @description
 * The country field of an address form. Named for addresses to keep it distinct
 * from {@link CountrySelector}, which is the searchable picker used to add
 * countries to a zone.
 *
 * `value` must never be `undefined` by the time it reaches `Select`. Base UI
 * decides on its first render whether it is controlled, by testing
 * `value !== undefined`, and an address form renders once before react-hook-form
 * has applied the saved address. Passing `undefined` on that first render leaves
 * the Select uncontrolled for good, so the saved country never appears.
 */
export function AddressCountrySelect({ value, onChange }: Readonly<AddressCountrySelectProps>) {
    const { t } = useLingui();
    const { data, isPending } = useAvailableCountries();

    if (isPending) {
        return <Skeleton className="h-9 w-full" />;
    }

    const countries = data?.countries.items ?? [];

    return (
        <Select
            items={Object.fromEntries(countries.map(country => [country.code, country.name]))}
            value={value ?? ''}
            onValueChange={newValue => {
                // The Select has no clear affordance, so an empty value only arrives if Base
                // UI emits one during teardown. Ignoring it keeps the saved country in the
                // form rather than blanking a required field.
                if (newValue) {
                    onChange(newValue);
                }
            }}
        >
            <SelectTrigger aria-label={t`Country`}>
                <SelectValue placeholder={<Trans>Select a country</Trans>} />
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
