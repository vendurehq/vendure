import { Button } from '@/vdb/components/ui/button.js';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
} from '@/vdb/components/ui/combobox.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { ComboboxPrimitive } from '@vendure-io/ui/lib/base-ui';
import { Plus } from 'lucide-react';
import { useId, useRef, useState } from 'react';

const countryListDocument = graphql(`
    query CountryList($options: CountryListOptions) {
        countries(options: $options) {
            items {
                id
                name
                code
            }
            totalItems
        }
    }
`);

export interface Country {
    id: string;
    name: string;
    code: string;
}

export interface CountrySelectorProps {
    onSelect: (value: Country) => void;
    label?: string | React.ReactNode;
    readOnly?: boolean;
}

export function CountrySelector(props: CountrySelectorProps) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const anchor = useRef<HTMLButtonElement>(null);
    const labelId = useId();

    const { data, isFetching } = useQuery({
        queryKey: ['countries', debouncedSearchTerm],
        queryFn: () =>
            api.query(countryListDocument, {
                options: {
                    sort: { name: 'ASC' },
                    filter: debouncedSearchTerm
                        ? {
                              name: { contains: debouncedSearchTerm },
                              code: { contains: debouncedSearchTerm },
                          }
                        : undefined,
                    filterOperator: debouncedSearchTerm ? 'OR' : undefined,
                },
            }),
    });

    return (
        <Combobox
            items={data?.countries.items ?? []}
            filter={null}
            value={null}
            onValueChange={(country: Country | null) => {
                if (country) {
                    props.onSelect(country);
                    setOpen(false);
                }
            }}
            open={open}
            onOpenChange={setOpen}
            inputValue={searchTerm}
            onInputValueChange={setSearchTerm}
            itemToStringLabel={(country: Country) => country.name}
            isItemEqualToValue={(a: Country, b: Country) => a.id === b.id}
            isLoading={isFetching || searchTerm !== debouncedSearchTerm}
            disabled={props.readOnly}
        >
            <ComboboxPrimitive.Trigger
                ref={anchor}
                aria-labelledby={labelId}
                render={<Button variant="outline" size="sm" type="button" />}
            >
                <Plus />
                <span id={labelId}>{props.label ?? <Trans>Select country</Trans>}</span>
            </ComboboxPrimitive.Trigger>
            <ComboboxContent anchor={anchor} className="w-80">
                <ComboboxInput
                    aria-label={t`Search countries`}
                    placeholder={t`Search countries`}
                    showTrigger={false}
                />
                <ComboboxEmpty>
                    <Trans>No countries found</Trans>
                </ComboboxEmpty>
                <ComboboxList>
                    {(country: Country) => (
                        <ComboboxItem key={country.id} value={country}>
                            <span className="flex flex-col">
                                <span className="font-medium">{country.name}</span>
                                <span className="text-xs text-muted-foreground">{country.code}</span>
                            </span>
                        </ComboboxItem>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}
