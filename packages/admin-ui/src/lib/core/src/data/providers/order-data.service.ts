import * as Codegen from '../../common/generated-types';
import {
    ADD_ITEM_TO_DRAFT_ORDER,
    ADD_MANUAL_PAYMENT_TO_ORDER,
    ADD_NOTE_TO_ORDER,
    ADJUST_DRAFT_ORDER_LINE,
    APPLY_COUPON_CODE_TO_DRAFT_ORDER,
    CANCEL_ORDER,
    CANCEL_PAYMENT,
    CREATE_DRAFT_ORDER,
    CREATE_FULFILLMENT,
    DELETE_DRAFT_ORDER,
    DELETE_ORDER_NOTE,
    DRAFT_ORDER_ELIGIBLE_SHIPPING_METHODS,
    GET_ORDER,
    GET_ORDER_HISTORY,
    GET_ORDERS_LIST,
    MODIFY_ORDER,
    REFUND_ORDER,
    REMOVE_COUPON_CODE_FROM_DRAFT_ORDER,
    REMOVE_DRAFT_ORDER_LINE,
    SET_BILLING_ADDRESS_FOR_DRAFT_ORDER,
    SET_CUSTOMER_FOR_DRAFT_ORDER,
    SET_DRAFT_ORDER_SHIPPING_METHOD,
    SET_SHIPPING_ADDRESS_FOR_DRAFT_ORDER,
    SETTLE_PAYMENT,
    SETTLE_REFUND,
    TRANSITION_FULFILLMENT_TO_STATE,
    TRANSITION_ORDER_TO_STATE,
    TRANSITION_PAYMENT_TO_STATE,
    UNSET_BILLING_ADDRESS_FOR_DRAFT_ORDER,
    UNSET_SHIPPING_ADDRESS_FOR_DRAFT_ORDER,
    UPDATE_ORDER_CUSTOM_FIELDS,
    UPDATE_ORDER_NOTE,
} from '../definitions/order-definitions';

import { BaseDataService } from './base-data.service';

export class OrderDataService {
    constructor(private baseDataService: BaseDataService) {}

    getOrders(options: Codegen.OrderListOptions = { take: 10 }) {
        return this.baseDataService.query<Codegen.GetOrderListQuery, Codegen.GetOrderListQueryVariables>(
            GET_ORDERS_LIST,
            {
                options,
            },
        );
    }

    getOrder(id: string) {
        return this.baseDataService.query<Codegen.GetOrderQuery, Codegen.GetOrderQueryVariables>(GET_ORDER, {
            id,
        });
    }

    getOrderHistory(id: string, options?: Codegen.HistoryEntryListOptions) {
        return this.baseDataService.query<
            Codegen.GetOrderHistoryQuery,
            Codegen.GetOrderHistoryQueryVariables
        >(GET_ORDER_HISTORY, {
            id,
            options,
        });
    }

    settlePayment(id: string) {
        return this.baseDataService.mutate<
            Codegen.SettlePaymentMutation,
            Codegen.SettlePaymentMutationVariables
        >(SETTLE_PAYMENT, {
            id,
        });
    }

    cancelPayment(id: string) {
        return this.baseDataService.mutate<
            Codegen.CancelPaymentMutation,
            Codegen.CancelPaymentMutationVariables
        >(CANCEL_PAYMENT, {
            id,
        });
    }

    transitionPaymentToState(id: string, state: string) {
        return this.baseDataService.mutate<
            Codegen.TransitionPaymentToStateMutation,
            Codegen.TransitionPaymentToStateMutationVariables
        >(TRANSITION_PAYMENT_TO_STATE, {
            id,
            state,
        });
    }

    createFulfillment(input: Codegen.FulfillOrderInput) {
        return this.baseDataService.mutate<
            Codegen.CreateFulfillmentMutation,
            Codegen.CreateFulfillmentMutationVariables
        >(CREATE_FULFILLMENT, {
            input,
        });
    }

    transitionFulfillmentToState(id: string, state: string) {
        return this.baseDataService.mutate<
            Codegen.TransitionFulfillmentToStateMutation,
            Codegen.TransitionFulfillmentToStateMutationVariables
        >(TRANSITION_FULFILLMENT_TO_STATE, {
            id,
            state,
        });
    }

    cancelOrder(input: Codegen.CancelOrderInput) {
        return this.baseDataService.mutate<Codegen.CancelOrderMutation, Codegen.CancelOrderMutationVariables>(
            CANCEL_ORDER,
            {
                input,
            },
        );
    }

    refundOrder(input: Codegen.RefundOrderInput) {
        return this.baseDataService.mutate<Codegen.RefundOrderMutation, Codegen.RefundOrderMutationVariables>(
            REFUND_ORDER,
            {
                input,
            },
        );
    }

    settleRefund(input: Codegen.SettleRefundInput, orderId: string) {
        return this.baseDataService.mutate<
            Codegen.SettleRefundMutation,
            Codegen.SettleRefundMutationVariables
        >(SETTLE_REFUND, {
            input,
        });
    }

    addNoteToOrder(input: Codegen.AddNoteToOrderInput) {
        return this.baseDataService.mutate<
            Codegen.AddNoteToOrderMutation,
            Codegen.AddNoteToOrderMutationVariables
        >(ADD_NOTE_TO_ORDER, {
            input,
        });
    }

    updateOrderNote(input: Codegen.UpdateOrderNoteInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateOrderNoteMutation,
            Codegen.UpdateOrderNoteMutationVariables
        >(UPDATE_ORDER_NOTE, {
            input,
        });
    }

    deleteOrderNote(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteOrderNoteMutation,
            Codegen.DeleteOrderNoteMutationVariables
        >(DELETE_ORDER_NOTE, {
            id,
        });
    }

    transitionToState(id: string, state: string) {
        return this.baseDataService.mutate<
            Codegen.TransitionOrderToStateMutation,
            Codegen.TransitionOrderToStateMutationVariables
        >(TRANSITION_ORDER_TO_STATE, {
            id,
            state,
        });
    }

    updateOrderCustomFields(input: Codegen.UpdateOrderInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateOrderCustomFieldsMutation,
            Codegen.UpdateOrderCustomFieldsMutationVariables
        >(UPDATE_ORDER_CUSTOM_FIELDS, {
            input,
        });
    }

    modifyOrder(input: Codegen.ModifyOrderInput) {
        return this.baseDataService.mutate<Codegen.ModifyOrderMutation, Codegen.ModifyOrderMutationVariables>(
            MODIFY_ORDER,
            {
                input,
            },
        );
    }

    addManualPaymentToOrder(input: Codegen.ManualPaymentInput) {
        return this.baseDataService.mutate<
            Codegen.AddManualPaymentMutation,
            Codegen.AddManualPaymentMutationVariables
        >(ADD_MANUAL_PAYMENT_TO_ORDER, { input });
    }

    createDraftOrder() {
        return this.baseDataService.mutate<Codegen.CreateDraftOrderMutation>(CREATE_DRAFT_ORDER);
    }

    deleteDraftOrder(orderId: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteDraftOrderMutation,
            Codegen.DeleteDraftOrderMutationVariables
        >(DELETE_DRAFT_ORDER, { orderId });
    }

    addItemToDraftOrder(orderId: string, input: Codegen.AddItemToDraftOrderInput) {
        return this.baseDataService.mutate<
            Codegen.AddItemToDraftOrderMutation,
            Codegen.AddItemToDraftOrderMutationVariables
        >(ADD_ITEM_TO_DRAFT_ORDER, { orderId, input });
    }

    adjustDraftOrderLine(orderId: string, input: Codegen.AdjustDraftOrderLineInput) {
        return this.baseDataService.mutate<
            Codegen.AdjustDraftOrderLineMutation,
            Codegen.AdjustDraftOrderLineMutationVariables
        >(ADJUST_DRAFT_ORDER_LINE, { orderId, input });
    }

    removeDraftOrderLine(orderId: string, orderLineId: string) {
        return this.baseDataService.mutate<
            Codegen.RemoveDraftOrderLineMutation,
            Codegen.RemoveDraftOrderLineMutationVariables
        >(REMOVE_DRAFT_ORDER_LINE, { orderId, orderLineId });
    }

    setCustomerForDraftOrder(
        orderId: string,
        { customerId, input }: { customerId?: string; input?: Codegen.CreateCustomerInput },
    ) {
        return this.baseDataService.mutate<
            Codegen.SetCustomerForDraftOrderMutation,
            Codegen.SetCustomerForDraftOrderMutationVariables
        >(SET_CUSTOMER_FOR_DRAFT_ORDER, { orderId, customerId, input });
    }

    setDraftOrderShippingAddress(orderId: string, input: Codegen.CreateAddressInput) {
        return this.baseDataService.mutate<
            Codegen.SetDraftOrderShippingAddressMutation,
            Codegen.SetDraftOrderShippingAddressMutationVariables
        >(SET_SHIPPING_ADDRESS_FOR_DRAFT_ORDER, { orderId, input });
    }

    setDraftOrderBillingAddress(orderId: string, input: Codegen.CreateAddressInput) {
        return this.baseDataService.mutate<
            Codegen.SetDraftOrderBillingAddressMutation,
            Codegen.SetDraftOrderBillingAddressMutationVariables
        >(SET_BILLING_ADDRESS_FOR_DRAFT_ORDER, { orderId, input });
    }

    unsetDraftOrderShippingAddress(orderId: string) {
        return this.baseDataService.mutate<
            Codegen.UnsetDraftOrderShippingAddressMutation,
            Codegen.UnsetDraftOrderShippingAddressMutationVariables
        >(UNSET_SHIPPING_ADDRESS_FOR_DRAFT_ORDER, { orderId });
    }

    unsetDraftOrderBillingAddress(orderId: string) {
        return this.baseDataService.mutate<
            Codegen.UnsetDraftOrderBillingAddressMutation,
            Codegen.UnsetDraftOrderBillingAddressMutationVariables
        >(UNSET_BILLING_ADDRESS_FOR_DRAFT_ORDER, { orderId });
    }

    applyCouponCodeToDraftOrder(orderId: string, couponCode: string) {
        return this.baseDataService.mutate<
            Codegen.ApplyCouponCodeToDraftOrderMutation,
            Codegen.ApplyCouponCodeToDraftOrderMutationVariables
        >(APPLY_COUPON_CODE_TO_DRAFT_ORDER, { orderId, couponCode });
    }

    removeCouponCodeFromDraftOrder(orderId: string, couponCode: string) {
        return this.baseDataService.mutate<
            Codegen.RemoveCouponCodeFromDraftOrderMutation,
            Codegen.RemoveCouponCodeFromDraftOrderMutationVariables
        >(REMOVE_COUPON_CODE_FROM_DRAFT_ORDER, { orderId, couponCode });
    }

    getDraftOrderEligibleShippingMethods(orderId: string) {
        return this.baseDataService.query<
            Codegen.DraftOrderEligibleShippingMethodsQuery,
            Codegen.DraftOrderEligibleShippingMethodsQueryVariables
        >(DRAFT_ORDER_ELIGIBLE_SHIPPING_METHODS, { orderId });
    }

    setDraftOrderShippingMethod(orderId: string, shippingMethodId: string) {
        return this.baseDataService.mutate<
            Codegen.SetDraftOrderShippingMethodMutation,
            Codegen.SetDraftOrderShippingMethodMutationVariables
        >(SET_DRAFT_ORDER_SHIPPING_METHOD, { orderId, shippingMethodId });
    }
}
