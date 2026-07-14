import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';

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
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const { data, isLoading } = useQuery({
        queryKey: ['countries', searchTerm],
        queryFn: () =>
            api.query(countryListDocument, {
                options: {
                    sort: { name: 'ASC' },
                    filter: searchTerm
                        ? {
                              name: { contains: searchTerm },
                              code: { contains: searchTerm },
                          }
                        : undefined,
                    filterOperator: searchTerm ? 'OR' : undefined,
                },
            }),
        staleTime: 1000 * 60 * 60, // 1 hour
    });

    const handleSearch = (value: string) => {
        setSearchTerm(value);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" type="button" disabled={props.readOnly} className="gap-2" />}>
                    <Plus className="h-4 w-4" />
                    {props.label ?? <Trans>Select country</Trans>}
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[350px]" align="start">
                <Command shouldFilter={false}>
                    <div className="flex items-center border-b px-3">
                        <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                        <CommandInput
                            placeholder="Search countries..."
                            onValueChange={handleSearch}
                            className="h-10 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <CommandList>
                        <CommandEmpty>
                            {isLoading ? <Trans>Loading...</Trans> : <Trans>No countries found</Trans>}
                        </CommandEmpty>
                        {data?.countries.items.map(country => (
                            <CommandItem
                                key={country.id}
                                onSelect={() => {
                                    props.onSelect(country);
                                    setOpen(false);
                                }}
                                className="flex flex-col items-start"
                            >
                                <div className="font-medium">{country.name}</div>
                                <div className="text-sm text-muted-foreground">{country.code}</div>
                            </CommandItem>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
