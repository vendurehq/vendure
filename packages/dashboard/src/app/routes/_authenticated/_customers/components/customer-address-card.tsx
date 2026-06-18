import { ResultOf } from '@/vdb/graphql/graphql.js';

import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { EditIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
    addressFragment,
    deleteCustomerAddressDocument,
    updateCustomerAddressDocument,
} from '../customers.graphql.js';
import { AddressFormValues, CustomerAddressForm } from './customer-address-form.js';

export function CustomerAddressCard({
    address,
    editable = false,
    deletable = false,
    onUpdate,
    onDelete,
}: {
    address: ResultOf<typeof addressFragment>;
    editable?: boolean;
    deletable?: boolean;
    onUpdate?: () => void;
    onDelete?: () => void;
}) {
    const [open, setOpen] = useState(false);
    const { t } = useLingui();
    const { mutate: deleteAddress } = useMutation({
        mutationFn: api.mutate(deleteCustomerAddressDocument),
        onSuccess: () => {
            toast.success(t`Address deleted successfully`);
            onDelete?.();
        },
        onError: () => {
            toast.error(t`Failed to delete address`);
        },
    });

    // Set up mutation for updating address
    const { mutate: updateAddress } = useMutation({
        mutationFn: api.mutate(updateCustomerAddressDocument),
        onSuccess: () => {
            toast.success(t`Address updated successfully`);
            onUpdate?.();
        },
        onError: error => {
            toast.error(t`Failed to update address`);
            console.error('Error updating address:', error);
        },
    });

    // Form submission handler
    const onSubmit = (values: AddressFormValues) => {
        // Type assertion to handle the mutation parameters
        updateAddress({
            input: {
                id: values.id,
                fullName: values.fullName,
                company: values.company,
                streetLine1: values.streetLine1,
                streetLine2: values.streetLine2,
                city: values.city,
                province: values.province,
                postalCode: values.postalCode,
                countryCode: values.countryCode,
                phoneNumber: values.phoneNumber,
                defaultShippingAddress: values.defaultShippingAddress,
                defaultBillingAddress: values.defaultBillingAddress,
                customFields: values.customFields,
            },
        } as any);
        setOpen(false);
    };

    return (
        <div className="border border-border rounded-md p-4 relative text-sm">
            {(address.defaultShippingAddress || address.defaultBillingAddress) && (
                <div className="flex flex-wrap gap-1 mb-2">
                    {address.defaultShippingAddress && (
                        <Badge className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-md">
                            Default Shipping
                        </Badge>
                    )}
                    {address.defaultBillingAddress && (
                        <Badge className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-md">
                            Default Billing
                        </Badge>
                    )}
                </div>
            )}

            <div className="flex flex-col gap-1">
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

            {(editable || deletable) && (
                <div className="flex gap-4 mt-3 pt-3 border-t border-border">
                    {editable && (
                        <Dialog open={open} onOpenChange={setOpen}>
                            <DialogTrigger>
                                <EditIcon className="w-4 h-4" />
                            </DialogTrigger>
                            <DialogContent className="max-h-[90vh] overflow-y-auto">
                                <DialogHeader>
                                    <DialogTitle>
                                        <Trans>Edit Address</Trans>
                                    </DialogTitle>
                                    <DialogDescription>
                                        <Trans>Edit the address details below.</Trans>
                                    </DialogDescription>
                                </DialogHeader>
                                <CustomerAddressForm address={address} onSubmit={onSubmit} />
                            </DialogContent>
                        </Dialog>
                    )}
                    {deletable && (
                        <ConfirmationDialog
                            title={t`Delete Address`}
                            description={t`Are you sure you want to delete this address?`}
                            onConfirm={() => {
                                deleteAddress({ id: address.id });
                                onDelete?.();
                            }}
                        >
                            <TrashIcon className="w-4 h-4 text-destructive" />
                        </ConfirmationDialog>
                    )}
                </div>
            )}
        </div>
    );
}
