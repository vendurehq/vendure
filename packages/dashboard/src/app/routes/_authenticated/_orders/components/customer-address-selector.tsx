import { Button } from '@/vdb/components/ui/button.js';
import { Card } from '@/vdb/components/ui/card.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql, ResultOf } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { cn } from '@/vdb/lib/utils.js';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { addressFragment } from '../../_customers/customers.graphql.js';

const getCustomerAddressesDocument = graphql(
    `
        query GetCustomerAddresses($customerId: ID!) {
            customer(id: $customerId) {
                id
                addresses {
                    ...Address
                }
            }
        }
    `,
    [addressFragment],
);

type CustomerAddressesQuery = ResultOf<typeof getCustomerAddressesDocument>;

interface CustomerAddressSelectorProps {
    customerId: string | undefined;
    onSelect: (address: ResultOf<typeof addressFragment>) => void;
    onCancel?: () => void;
    defaultOpen?: boolean;
}

export function CustomerAddressSelector({
    customerId,
    onSelect,
    onCancel,
    defaultOpen = false,
}: Readonly<CustomerAddressSelectorProps>) {
    const [open, setOpen] = useState(defaultOpen);

    const { data, isLoading } = useQuery<CustomerAddressesQuery>({
        queryKey: ['customerAddresses', customerId],
        queryFn: () => api.query(getCustomerAddressesDocument, { customerId: customerId ?? '' }),
        enabled: !!customerId,
    });

    const addresses: ResultOf<typeof addressFragment>[] = data?.customer?.addresses || [];

    return (
        <Popover
            open={open}
            onOpenChange={value => {
                setOpen(value);
                if (!value) {
                    onCancel?.();
                }
            }}
        >
            <PopoverTrigger render={<div className="flex items-center gap-2" />}>
                <Button variant="outline" size="sm" type="button" className="" disabled={!customerId}>
                    <Plus className="h-4 w-4" />
                    <Trans>Select address</Trans>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
                <div className="p-4">
                    <h4 className="mb-4">
                        <Trans>Select an address</Trans>
                    </h4>
                    <div className="space-y-2">
                        {isLoading ? (
                            <div className="text-sm text-muted-foreground">
                                <Trans>Loading addresses...</Trans>
                            </div>
                        ) : addresses.length === 0 ? (
                            <div className="text-sm text-muted-foreground">
                                <Trans>No addresses found</Trans>
                            </div>
                        ) : (
                            addresses.map(address => (
                                <Card
                                    key={address.id}
                                    className={cn('p-4 cursor-pointer hover:bg-accent transition-colors')}
                                    onClick={() => {
                                        onSelect(address);
                                        setOpen(false);
                                    }}
                                >
                                    <div className="flex flex-col gap-1 text-sm">
                                        <div className="font-semibold">{address.fullName}</div>
                                        {address.company && <div>{address.company}</div>}
                                        <div>{address.streetLine1}</div>
                                        {address.streetLine2 && <div>{address.streetLine2}</div>}
                                        <div>
                                            {address.city}
                                            {address.province && `, ${address.province}`}
                                        </div>
                                        <div>{address.postalCode}</div>
                                        <div>{address.country.name}</div>
                                        {address.phoneNumber && <div>{address.phoneNumber}</div>}
                                    </div>
                                </Card>
                            ))
                        )}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
