import gql from 'graphql-tag';

export const PAYMENT_METHOD_FRAGMENT = gql`
    fragment PaymentMethod on PaymentMethod {
        id
        code
        name
        description
        enabled
        checker {
            code
            args {
                name
                value
            }
        }
        handler {
            code
            args {
                name
                value
            }
        }
    }
`;

export const CREATE_PAYMENT_METHOD = gql`
    mutation CreatePaymentMethod($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            ...PaymentMethod
        }
    }
    ${PAYMENT_METHOD_FRAGMENT}
`;

export const GET_CUSTOMER_LIST = gql`
    query GetCustomerList($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                id
                title
                firstName
                lastName
                emailAddress
                phoneNumber
                user {
                    id
                    verified
                }
            }
            totalItems
        }
    }
`;

const REFUND_FRAGMENT = gql`
    fragment Refund on Refund {
        id
        state
        items
        transactionId
        shipping
        total
        metadata
    }
`;

export const REFUND_ORDER = gql`
    mutation RefundOrder($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ...Refund
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
    ${REFUND_FRAGMENT}
`;

export const GET_ORDER_PAYMENTS = gql`
    query order($id: ID!) {
        order(id: $id) {
            id
            state
            totalWithTax
            payments {
                id
                transactionId
                method
                amount
                state
                errorMessage
                metadata
            }
        }
    }
`;

export const CREATE_CHANNEL = gql`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            ... on Channel {
                id
                code
                token
                currencyCode
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const CREATE_COUPON = gql`
    mutation CreatePromotion($input: CreatePromotionInput!) {
        createPromotion(input: $input) {
            ... on ErrorResult {
                errorCode
            }
            __typename
        }
    }
`;
