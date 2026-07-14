import { Button } from '@/vdb/components/ui/button.js';
import { Command, CommandEmpty, CommandItem, CommandList } from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';

const customerGroupsDocument = graphql(`
    query GetCustomerGroups($options: CustomerGroupListOptions) {
        customerGroups(options: $options) {
            items {
                id
                name
            }
        }
    }
`);

export interface CustomerGroupSelectorProps {
    onSelect: (value: { id: string; name: string }) => void;
    readOnly?: boolean;
}

export function CustomerGroupSelector(props: CustomerGroupSelectorProps) {
    const [open, setOpen] = useState(false);

    const { data: groups, isLoading } = useQuery({
        queryKey: ['customerGroups'],
        queryFn: () =>
            api.query(customerGroupsDocument, {
                options: {
                    sort: { name: 'ASC' },
                },
            }),
        staleTime: 1000 * 60 * 5,
    });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" type="button" disabled={props.readOnly} className="gap-2" />}>
                    <Plus className="h-4 w-4" />
                    <Trans>Add customer groups</Trans>
            </PopoverTrigger>
            <PopoverContent className="p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandList>
                        {groups?.customerGroups.items.map(group => (
                            <CommandItem key={group.id} onSelect={() => props.onSelect(group)}>
                                {group.name}
                            </CommandItem>
                        ))}
                        <CommandEmpty>
                            {isLoading ? <Trans>Loading...</Trans> : <Trans>No results</Trans>}
                        </CommandEmpty>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
