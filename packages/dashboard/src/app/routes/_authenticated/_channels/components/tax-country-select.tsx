import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { useAvailableCountries } from '@/vdb/hooks/use-available-countries.js';
import { Trans, useLingui } from '@lingui/react/macro';

const NO_COUNTRY = '__none__';

export interface TaxCountrySelectProps {
    value: string | null | undefined;
    onChange: (value: string | null) => void;
}

/**
 * @description
 * Selects the tax country of a Channel by its code, or none. The enabled countries are offered.
 * A saved country that is not enabled stays selectable, so that saving the form keeps it.
 */
export function TaxCountrySelect({ value, onChange }: Readonly<TaxCountrySelectProps>) {
    const { t } = useLingui();
    const { data, isPending } = useAvailableCountries();

    if (isPending) {
        return <Skeleton className="h-9 w-full" />;
    }

    const countries = data?.countries.items ?? [];
    const options = [
        ...countries.map(country => ({ code: country.code, name: country.name })),
        ...(value && !countries.some(country => country.code === value) ? [{ code: value, name: value }] : []),
    ];
    const noneLabel = t`None`;

    return (
        <Select
            items={{
                [NO_COUNTRY]: noneLabel,
                ...Object.fromEntries(options.map(option => [option.code, option.name])),
            }}
            value={value || NO_COUNTRY}
            onValueChange={newValue => {
                // An empty value only arrives if Base UI emits one during teardown, see AddressCountrySelect
                if (newValue) {
                    onChange(newValue === NO_COUNTRY ? null : (newValue as string));
                }
            }}
        >
            <SelectTrigger aria-label={t`Tax country`}>
                <SelectValue placeholder={<Trans>Select a country</Trans>} />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={NO_COUNTRY}>{noneLabel}</SelectItem>
                {options.map(option => (
                    <SelectItem key={option.code} value={option.code}>
                        {option.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}
