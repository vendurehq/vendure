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
import { useDebounce } from '@uidotdev/usehooks';
import { Plus } from 'lucide-react';
import { useState } from 'react';

const customersDocument = graphql(`
    query GetCustomers($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                firstName
                lastName
                emailAddress
            }
            totalItems
        }
    }
`);

export interface Customer {
    id: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
}

export interface CustomerSelectorProps {
    onSelect: (value: Customer) => void;
    label?: string | React.ReactNode;
    readOnly?: boolean;
}

export function CustomerSelector(props: CustomerSelectorProps) {
    const [open, setOpen] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const { data, isLoading } = useQuery({
        queryKey: ['customers', debouncedSearchTerm],
        queryFn: () =>
            api.query(customersDocument, {
                options: {
                    sort: { lastName: 'ASC' },
                    filter: debouncedSearchTerm
                        ? {
                              firstName: { contains: debouncedSearchTerm },
                              lastName: { contains: debouncedSearchTerm },
                              emailAddress: { contains: debouncedSearchTerm },
                          }
                        : undefined,
                    filterOperator: debouncedSearchTerm ? 'OR' : undefined,
                },
            }),
        staleTime: 1000 * 60, // 1 minute
    });

    const handleSearch = (value: string) => {
        setSearchTerm(value);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" type="button" disabled={props.readOnly} className="gap-2" />}>
                    <Plus className="h-4 w-4" />
                    {props.label ?? <Trans>Select customer</Trans>}
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[350px]" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Search customers..."
                        onValueChange={handleSearch}
                        className="h-10 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                    />
                    <CommandList>
                        <CommandEmpty>
                            {isLoading ? <Trans>Loading...</Trans> : <Trans>No customers found</Trans>}
                        </CommandEmpty>
                        {data?.customers.items.map(customer => (
                            <CommandItem
                                key={customer.id}
                                onSelect={() => {
                                    props.onSelect(customer);
                                    setOpen(false);
                                }}
                                className="flex flex-col items-start"
                            >
                                <div className="font-medium">
                                    {customer.firstName} {customer.lastName}
                                </div>
                                <div className="text-sm text-muted-foreground">{customer.emailAddress}</div>
                            </CommandItem>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
