import { configurableOperationFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';

export const paymentMethodItemFragment = graphql(`
    fragment PaymentMethodItem on PaymentMethod {
        id
        createdAt
        updatedAt
        name
        description
        code
        enabled
    }
`);

export const paymentMethodListQuery = graphql(
    `
        query PaymentMethodList($options: PaymentMethodListOptions) {
            paymentMethods(options: $options) {
                items {
                    ...PaymentMethodItem
                }
                totalItems
            }
        }
    `,
    [paymentMethodItemFragment],
);

export const paymentMethodDetailDocument = graphql(
    `
        query PaymentMethodDetail($id: ID!) {
            paymentMethod(id: $id) {
                id
                createdAt
                updatedAt
                name
                code
                description
                enabled
                translations {
                    id
                    languageCode
                    name
                    description
                }
                checker {
                    ...ConfigurableOperation
                }
                handler {
                    ...ConfigurableOperation
                }
                customFields
            }
        }
    `,
    [configurableOperationFragment],
);

export const createPaymentMethodDocument = graphql(`
    mutation CreatePaymentMethod($input: CreatePaymentMethodInput!) {
        createPaymentMethod(input: $input) {
            id
        }
    }
`);

export const updatePaymentMethodDocument = graphql(`
    mutation UpdatePaymentMethod($input: UpdatePaymentMethodInput!) {
        updatePaymentMethod(input: $input) {
            id
        }
    }
`);

export const deletePaymentMethodDocument = graphql(`
    mutation DeletePaymentMethod($id: ID!) {
        deletePaymentMethod(id: $id) {
            result
            message
        }
    }
`);

export const deletePaymentMethodsDocument = graphql(`
    mutation DeletePaymentMethods($ids: [ID!]!) {
        deletePaymentMethods(ids: $ids) {
            result
            message
        }
    }
`);

export const assignPaymentMethodsToChannelDocument = graphql(`
    mutation AssignPaymentMethodsToChannel($input: AssignPaymentMethodsToChannelInput!) {
        assignPaymentMethodsToChannel(input: $input) {
            id
            name
        }
    }
`);

export const removePaymentMethodsFromChannelDocument = graphql(`
    mutation RemovePaymentMethodsFromChannel($input: RemovePaymentMethodsFromChannelInput!) {
        removePaymentMethodsFromChannel(input: $input) {
            id
            name
        }
    }
`);
