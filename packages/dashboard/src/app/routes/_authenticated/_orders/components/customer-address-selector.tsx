import { AddressFormValues, CustomerAddressForm } from '@/vdb/components/shared/customer-address-form.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Card } from '@/vdb/components/ui/card.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/vdb/components/ui/tabs.js';
import { api } from '@/vdb/graphql/api.js';
import { ResultOf } from '@/vdb/graphql/graphql.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { VariablesOf } from 'gql.tada';
import { Link, Plus } from 'lucide-react';
import { useState } from 'react';
import { addressFragment } from '../../_customers/customers.graphql.js';
import { getCustomerAddressesDocument, setShippingAddressForDraftOrderDocument } from '../orders.graphql.js';

type CustomerAddressesQuery = ResultOf<typeof getCustomerAddressesDocument>;

export type CreateAddressInput = VariablesOf<typeof setShippingAddressForDraftOrderDocument>['input'];

interface CustomerAddressSelectorProps {
    customerId: string | undefined;
    onSelect: (address: ResultOf<typeof addressFragment>) => void;
    /**
     * @description
     * Called when a new, ad-hoc address is entered via the "New address" tab. Receives a
     * {@link CreateAddressInput} ready to be passed to the draft order address mutations.
     */
    onSubmitNew: (input: CreateAddressInput) => void;
    onCancel?: () => void;
    defaultOpen?: boolean;
}

export function CustomerAddressSelector({
    customerId,
    onSelect,
    onSubmitNew,
    onCancel,
    defaultOpen = false,
}: Readonly<CustomerAddressSelectorProps>) {
    const [open, setOpen] = useState(defaultOpen);
    const [activeTab, setActiveTab] = useState<string>('existing');

    const { data, isLoading } = useQuery<CustomerAddressesQuery>({
        queryKey: ['customerAddresses', customerId],
        queryFn: () => api.query(getCustomerAddressesDocument, { customerId: customerId ?? '' }),
        enabled: !!customerId,
    });

    const addresses: ResultOf<typeof addressFragment>[] = data?.customer?.addresses || [];
    // Existing addresses are only selectable when a customer with saved addresses is present.
    // Otherwise, the admin can only enter a new ad-hoc address (matching the Angular admin-ui).
    const canSelectExisting = !!customerId && addresses.length > 0;
    // Only force the "new" tab once we know the customer has no selectable addresses. While the
    // query is still loading we honour the explicitly chosen tab so the selection doesn't jump
    // when the addresses transition from loading to loaded.
    const effectiveTab = canSelectExisting || (!!customerId && isLoading) ? activeTab : 'new';

    return (
        <Popover
            open={open}
            onOpenChange={value => {
                setOpen(value);
                if (!value) {
                    setActiveTab('existing');
                    onCancel?.();
                }
            }}
        >
            <PopoverTrigger render={<div className="flex items-center gap-2" />}>
                <Button variant="outline" size="sm" type="button">
                    <Plus className="h-4 w-4" />
                    <Trans>Select address</Trans>
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[520px] p-0" align="start">
                <div className="p-4">
                    <Tabs value={effectiveTab} onValueChange={setActiveTab}>
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="existing" disabled={!canSelectExisting}>
                                <Link className="mr-2 h-4 w-4" />
                                <Trans>Existing address</Trans>
                            </TabsTrigger>
                            <TabsTrigger value="new">
                                <Plus className="mr-2 h-4 w-4" />
                                <Trans>New address</Trans>
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent value="existing">
                            <div className="space-y-2 mt-2">
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
                                            className={cn(
                                                'p-4 cursor-pointer hover:bg-accent transition-colors',
                                            )}
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
                        </TabsContent>
                        <TabsContent value="new">
                            <div className="mt-2 max-h-[60vh] overflow-y-auto">
                                <CustomerAddressForm
                                    hideDefaultAddressFlags
                                    onSubmit={values => {
                                        onSubmitNew(mapFormValuesToInput(values));
                                        setOpen(false);
                                    }}
                                />
                            </div>
                        </TabsContent>
                    </Tabs>
                </div>
            </PopoverContent>
        </Popover>
    );
}

function mapFormValuesToInput(values: AddressFormValues): CreateAddressInput {
    return {
        fullName: values.fullName,
        company: values.company,
        streetLine1: values.streetLine1,
        streetLine2: values.streetLine2,
        city: values.city,
        province: values.province,
        postalCode: values.postalCode,
        countryCode: values.countryCode,
        phoneNumber: values.phoneNumber,
        customFields: values.customFields,
    };
}
