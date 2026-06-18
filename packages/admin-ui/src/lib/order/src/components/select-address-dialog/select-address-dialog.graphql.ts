import { ADDRESS_FRAGMENT } from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const GET_CUSTOMER_ADDRESSES = gql`
    query GetCustomerAddresses($customerId: ID!) {
        customer(id: $customerId) {
            id
            addresses {
                ...Address
            }
        }
    }
    ${ADDRESS_FRAGMENT}
`;
