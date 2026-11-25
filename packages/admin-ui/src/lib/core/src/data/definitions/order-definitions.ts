import { gql } from 'apollo-angular';

import { ERROR_RESULT_FRAGMENT } from './shared-definitions';

export const DISCOUNT_FRAGMENT = gql`
    fragment Discount on Discount {
        adjustmentSource
        amount
        amountWithTax
        description
        type
    }
`;

export const PAYMENT_FRAGMENT = gql`
    fragment Payment on Payment {
        id
        transactionId
        amount
        method
        state
        metadata
    }
`;

export const REFUND_FRAGMENT = gql`
    fragment Refund on Refund {
        id
        state
        items
        shipping
        adjustment
        transactionId
        paymentId
    }
`;

export const ORDER_ADDRESS_FRAGMENT = gql`
    fragment OrderAddress on OrderAddress {
        fullName
        company
        streetLine1
        streetLine2
        city
        province
        postalCode
        country
        countryCode
        phoneNumber
    }
`;

export const ORDER_FRAGMENT = gql`
    fragment Order on Order {
        id
        createdAt
        updatedAt
        type
        orderPlacedAt
        code
        state
        nextStates
        total
        totalWithTax
        currencyCode
        customer {
            id
            firstName
            lastName
        }
        shippingLines {
            shippingMethod {
                name
            }
        }
    }
`;

export const FULFILLMENT_FRAGMENT = gql`
    fragment Fulfillment on Fulfillment {
        id
        state
        nextStates
        createdAt
        updatedAt
        method
        lines {
            orderLineId
            quantity
        }
        trackingCode
    }
`;

export const PAYMENT_WITH_REFUNDS_FRAGMENT = gql`
    fragment PaymentWithRefunds on Payment {
        id
        createdAt
        transactionId
        amount
        method
        state
        nextStates
        errorMessage
        metadata
        refunds {
            id
            createdAt
            state
            items
            adjustment
            total
            paymentId
            reason
            transactionId
            method
            metadata
            lines {
                orderLineId
                quantity
            }
        }
    }
`;

export const ORDER_LINE_FRAGMENT = gql`
    fragment OrderLine on OrderLine {
        id
        createdAt
        updatedAt
        featuredAsset {
            preview
        }
        productVariant {
            id
            name
            sku
            trackInventory
            stockOnHand
            product {
                id
                name
            }
        }
        discounts {
            ...Discount
        }
        fulfillmentLines {
            fulfillmentId
            quantity
        }
        unitPrice
        unitPriceWithTax
        proratedUnitPrice
        proratedUnitPriceWithTax
        quantity
        orderPlacedQuantity
        linePrice
        lineTax
        linePriceWithTax
        discountedLinePrice
        discountedLinePriceWithTax
    }
`;

export const ORDER_DETAIL_FRAGMENT = gql`
    fragment OrderDetail on Order {
        id
        createdAt
        updatedAt
        type
        aggregateOrder {
            id
            code
        }
        sellerOrders {
            id
            code
            channels {
                id
                code
            }
        }
        code
        state
        nextStates
        active
        couponCodes
        customer {
            id
            firstName
            lastName
        }
        lines {
            ...OrderLine
        }
        surcharges {
            id
            sku
            description
            price
            priceWithTax
            taxRate
        }
        discounts {
            ...Discount
        }
        promotions {
            id
            couponCode
        }
        subTotal
        subTotalWithTax
        total
        totalWithTax
        currencyCode
        shipping
        shippingWithTax
        shippingLines {
            id
            discountedPriceWithTax
            shippingMethod {
                id
                code
                name
                fulfillmentHandlerCode
                description
            }
        }
        taxSummary {
            description
            taxBase
            taxRate
            taxTotal
        }
        shippingAddress {
            ...OrderAddress
        }
        billingAddress {
            ...OrderAddress
        }
        payments {
            ...PaymentWithRefunds
        }
        fulfillments {
            ...Fulfillment
        }
        modifications {
            id
            createdAt
            isSettled
            priceChange
            note
            payment {
                id
                amount
            }
            lines {
                orderLineId
                quantity
            }
            refund {
                id
                paymentId
                total
            }
            surcharges {
                id
            }
        }
    }
    ${DISCOUNT_FRAGMENT}
    ${ORDER_ADDRESS_FRAGMENT}
    ${FULFILLMENT_FRAGMENT}
    ${ORDER_LINE_FRAGMENT}
    ${PAYMENT_WITH_REFUNDS_FRAGMENT}
`;

export const GET_ORDERS_LIST = gql`
    query GetOrderList($options: OrderListOptions) {
        orders(options: $options) {
            items {
                ...Order
            }
            totalItems
        }
    }
    ${ORDER_FRAGMENT}
`;

export const GET_ORDER = gql`
    query GetOrder($id: ID!) {
        order(id: $id) {
            ...OrderDetail
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
`;

export const SETTLE_PAYMENT = gql`
    mutation SettlePayment($id: ID!) {
        settlePayment(id: $id) {
            ...Payment
            ...ErrorResult
            ... on SettlePaymentError {
                paymentErrorMessage
            }
            ... on PaymentStateTransitionError {
                transitionError
            }
            ... on OrderStateTransitionError {
                transitionError
            }
        }
    }
    ${ERROR_RESULT_FRAGMENT}
    ${PAYMENT_FRAGMENT}
`;

export const CANCEL_PAYMENT = gql`
    mutation CancelPayment($id: ID!) {
        cancelPayment(id: $id) {
            ...Payment
            ...ErrorResult
            ... on CancelPaymentError {
                paymentErrorMessage
            }
            ... on PaymentStateTransitionError {
                transitionError
            }
        }
    }
    ${ERROR_RESULT_FRAGMENT}
    ${PAYMENT_FRAGMENT}
`;

export const TRANSITION_PAYMENT_TO_STATE = gql`
    mutation TransitionPaymentToState($id: ID!, $state: String!) {
        transitionPaymentToState(id: $id, state: $state) {
            ...Payment
            ...ErrorResult
            ... on PaymentStateTransitionError {
                transitionError
            }
        }
    }
    ${PAYMENT_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const CREATE_FULFILLMENT = gql`
    mutation CreateFulfillment($input: FulfillOrderInput!) {
        addFulfillmentToOrder(input: $input) {
            ...Fulfillment
            ... on CreateFulfillmentError {
                errorCode
                message
                fulfillmentHandlerError
            }
            ... on FulfillmentStateTransitionError {
                errorCode
                message
                transitionError
            }
            ...ErrorResult
        }
    }
    ${FULFILLMENT_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const CANCEL_ORDER = gql`
    mutation CancelOrder($input: CancelOrderInput!) {
        cancelOrder(input: $input) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const REFUND_ORDER = gql`
    mutation RefundOrder($input: RefundOrderInput!) {
        refundOrder(input: $input) {
            ...Refund
            ...ErrorResult
        }
    }
    ${REFUND_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const SETTLE_REFUND = gql`
    mutation SettleRefund($input: SettleRefundInput!) {
        settleRefund(input: $input) {
            ...Refund
            ...ErrorResult
        }
    }
    ${REFUND_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const GET_ORDER_HISTORY = gql`
    query GetOrderHistory($id: ID!, $options: HistoryEntryListOptions) {
        order(id: $id) {
            id
            history(options: $options) {
                totalItems
                items {
                    id
                    type
                    createdAt
                    isPublic
                    administrator {
                        id
                        firstName
                        lastName
                    }
                    data
                }
            }
        }
    }
`;

export const ADD_NOTE_TO_ORDER = gql`
    mutation AddNoteToOrder($input: AddNoteToOrderInput!) {
        addNoteToOrder(input: $input) {
            id
        }
    }
`;

export const UPDATE_ORDER_NOTE = gql`
    mutation UpdateOrderNote($input: UpdateOrderNoteInput!) {
        updateOrderNote(input: $input) {
            id
            data
            isPublic
        }
    }
`;

export const DELETE_ORDER_NOTE = gql`
    mutation DeleteOrderNote($id: ID!) {
        deleteOrderNote(id: $id) {
            result
            message
        }
    }
`;

export const TRANSITION_ORDER_TO_STATE = gql`
    mutation TransitionOrderToState($id: ID!, $state: String!) {
        transitionOrderToState(id: $id, state: $state) {
            ...Order
            ...ErrorResult
            ... on OrderStateTransitionError {
                transitionError
            }
        }
    }
    ${ORDER_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const UPDATE_ORDER_CUSTOM_FIELDS = gql`
    mutation UpdateOrderCustomFields($input: UpdateOrderInput!) {
        setOrderCustomFields(input: $input) {
            ...Order
        }
    }
    ${ORDER_FRAGMENT}
`;

export const TRANSITION_FULFILLMENT_TO_STATE = gql`
    mutation TransitionFulfillmentToState($id: ID!, $state: String!) {
        transitionFulfillmentToState(id: $id, state: $state) {
            ...Fulfillment
            ...ErrorResult
            ... on FulfillmentStateTransitionError {
                transitionError
            }
        }
    }
    ${FULFILLMENT_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const MODIFY_ORDER = gql`
    mutation ModifyOrder($input: ModifyOrderInput!) {
        modifyOrder(input: $input) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const ADD_MANUAL_PAYMENT_TO_ORDER = gql`
    mutation AddManualPayment($input: ManualPaymentInput!) {
        addManualPaymentToOrder(input: $input) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const CREATE_DRAFT_ORDER = gql`
    mutation CreateDraftOrder {
        createDraftOrder {
            ...OrderDetail
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
`;

export const DELETE_DRAFT_ORDER = gql`
    mutation DeleteDraftOrder($orderId: ID!) {
        deleteDraftOrder(orderId: $orderId) {
            result
            message
        }
    }
`;

export const ADD_ITEM_TO_DRAFT_ORDER = gql`
    mutation AddItemToDraftOrder($orderId: ID!, $input: AddItemToDraftOrderInput!) {
        addItemToDraftOrder(orderId: $orderId, input: $input) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const ADJUST_DRAFT_ORDER_LINE = gql`
    mutation AdjustDraftOrderLine($orderId: ID!, $input: AdjustDraftOrderLineInput!) {
        adjustDraftOrderLine(orderId: $orderId, input: $input) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const REMOVE_DRAFT_ORDER_LINE = gql`
    mutation RemoveDraftOrderLine($orderId: ID!, $orderLineId: ID!) {
        removeDraftOrderLine(orderId: $orderId, orderLineId: $orderLineId) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const SET_CUSTOMER_FOR_DRAFT_ORDER = gql`
    mutation SetCustomerForDraftOrder($orderId: ID!, $customerId: ID, $input: CreateCustomerInput) {
        setCustomerForDraftOrder(orderId: $orderId, customerId: $customerId, input: $input) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const SET_SHIPPING_ADDRESS_FOR_DRAFT_ORDER = gql`
    mutation SetDraftOrderShippingAddress($orderId: ID!, $input: CreateAddressInput!) {
        setDraftOrderShippingAddress(orderId: $orderId, input: $input) {
            ...OrderDetail
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
`;

export const SET_BILLING_ADDRESS_FOR_DRAFT_ORDER = gql`
    mutation SetDraftOrderBillingAddress($orderId: ID!, $input: CreateAddressInput!) {
        setDraftOrderBillingAddress(orderId: $orderId, input: $input) {
            ...OrderDetail
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
`;

export const UNSET_SHIPPING_ADDRESS_FOR_DRAFT_ORDER = gql`
    mutation UnsetDraftOrderShippingAddress($orderId: ID!) {
        unsetDraftOrderShippingAddress(orderId: $orderId) {
            ...OrderDetail
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
`;

export const UNSET_BILLING_ADDRESS_FOR_DRAFT_ORDER = gql`
    mutation UnsetDraftOrderBillingAddress($orderId: ID!) {
        unsetDraftOrderBillingAddress(orderId: $orderId) {
            ...OrderDetail
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
`;

export const APPLY_COUPON_CODE_TO_DRAFT_ORDER = gql`
    mutation ApplyCouponCodeToDraftOrder($orderId: ID!, $couponCode: String!) {
        applyCouponCodeToDraftOrder(orderId: $orderId, couponCode: $couponCode) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const REMOVE_COUPON_CODE_FROM_DRAFT_ORDER = gql`
    mutation RemoveCouponCodeFromDraftOrder($orderId: ID!, $couponCode: String!) {
        removeCouponCodeFromDraftOrder(orderId: $orderId, couponCode: $couponCode) {
            ...OrderDetail
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
`;

export const DRAFT_ORDER_ELIGIBLE_SHIPPING_METHODS = gql`
    query DraftOrderEligibleShippingMethods($orderId: ID!) {
        eligibleShippingMethodsForDraftOrder(orderId: $orderId) {
            id
            name
            code
            description
            price
            priceWithTax
            metadata
        }
    }
`;

export const SET_DRAFT_ORDER_SHIPPING_METHOD = gql`
    mutation SetDraftOrderShippingMethod($orderId: ID!, $shippingMethodId: ID!) {
        setDraftOrderShippingMethod(orderId: $orderId, shippingMethodId: $shippingMethodId) {
            ...OrderDetail
            ...ErrorResult
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;
