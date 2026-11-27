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
import { ComboboxPrimitive } from '@vendure-io/ui/lib/base-ui';
import { Plus } from 'lucide-react';
import { useId, useRef, useState } from 'react';

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

type CustomerGroup = { id: string; name: string };

export interface CustomerGroupSelectorProps {
    onSelect: (value: { id: string; name: string }) => void;
    readOnly?: boolean;
}

export function CustomerGroupSelector(props: CustomerGroupSelectorProps) {
    const { t } = useLingui();
    const [open, setOpen] = useState(false);
    const anchor = useRef<HTMLButtonElement>(null);
    const labelId = useId();

    const { data: groups, isLoading } = useQuery({
        queryKey: ['customerGroups'],
        queryFn: () =>
            api.query(customerGroupsDocument, {
                options: {
                    sort: { name: 'ASC' },
                },
            }),
    });

    return (
        <Combobox
            items={groups?.customerGroups.items ?? []}
            value={null}
            onValueChange={(group: CustomerGroup | null) => {
                if (group) {
                    props.onSelect(group);
                    setOpen(false);
                }
            }}
            open={open}
            onOpenChange={setOpen}
            itemToStringLabel={(group: CustomerGroup) => group.name}
            isItemEqualToValue={(a: CustomerGroup, b: CustomerGroup) => a.id === b.id}
            isLoading={isLoading}
            disabled={props.readOnly}
        >
            <ComboboxPrimitive.Trigger
                ref={anchor}
                aria-labelledby={labelId}
                render={<Button variant="outline" size="sm" type="button" />}
            >
                <Plus />
                <span id={labelId}>
                    <Trans>Add customer groups</Trans>
                </span>
            </ComboboxPrimitive.Trigger>
            <ComboboxContent anchor={anchor} className="w-80">
                <ComboboxInput
                    aria-label={t`Search customer groups`}
                    placeholder={t`Search customer groups`}
                    showTrigger={false}
                />
                <ComboboxEmpty>
                    <Trans>No results</Trans>
                </ComboboxEmpty>
                <ComboboxList>
                    {(group: CustomerGroup) => (
                        <ComboboxItem key={group.id} value={group}>
                            {group.name}
                        </ComboboxItem>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}
