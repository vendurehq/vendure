import { ResultOf } from '@/vdb/graphql/graphql.js';
import {
    AddressFormValues,
    CustomerAddressForm as SharedCustomerAddressForm,
} from '@/vdb/components/shared/customer-address-form.js';
import { addressFragment } from '../customers.graphql.js';

export type { AddressFormValues } from '@/vdb/components/shared/customer-address-form.js';

function mapAddressToFormValues(address: ResultOf<typeof addressFragment>): AddressFormValues {
    return {
        id: address.id || '',
        fullName: address.fullName || '',
        company: address.company || '',
        streetLine1: address.streetLine1 || '',
        streetLine2: address.streetLine2 || '',
        city: address.city || '',
        province: address.province || '',
        postalCode: address.postalCode || '',
        countryCode: address.country.code || '',
        phoneNumber: address.phoneNumber || '',
        defaultShippingAddress: address.defaultShippingAddress || false,
        defaultBillingAddress: address.defaultBillingAddress || false,
        customFields: (address as any)?.customFields || {},
    };
}

interface CustomerAddressFormProps {
    address?: ResultOf<typeof addressFragment>;
    onSubmit?: (values: AddressFormValues) => void;
    onCancel?: () => void;
}

export function CustomerAddressForm({ address, onSubmit, onCancel }: Readonly<CustomerAddressFormProps>) {
    return (
        <SharedCustomerAddressForm
            address={address}
            setValuesForUpdate={mapAddressToFormValues}
            onSubmit={onSubmit}
            onCancel={onCancel}
        />
    );
}
