import {
    createBulkAssignToChannelAction,
    AssignPaymentMethodsToChannelDocument,
    RemovePaymentMethodsFromChannelDocument,
    createBulkDeleteAction,
    createBulkRemoveFromChannelAction,
    GetPaymentMethodListQuery,
    ItemOf,
    Permission,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { map } from 'rxjs/operators';

export const deletePaymentMethodsBulkAction = createBulkDeleteAction<
    ItemOf<GetPaymentMethodListQuery, 'paymentMethods'>
>({
    location: 'payment-method-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeletePaymentMethod) ||
        userPermissions.includes(Permission.DeleteSettings),
    getItemName: item => item.name,
    shouldRetryItem: (response, item) => !!response.message,
    bulkDelete: (dataService, ids, retrying) =>
        dataService.settings.deletePaymentMethods(ids, retrying).pipe(map(res => res.deletePaymentMethods)),
});

const ASSIGN_PAYMENT_METHODS_TO_CHANNEL = gql`
    mutation AssignPaymentMethodsToChannel($input: AssignPaymentMethodsToChannelInput!) {
        assignPaymentMethodsToChannel(input: $input) {
            id
            name
        }
    }
`;

const REMOVE_PAYMENT_METHODS_FROM_CHANNEL = gql`
    mutation RemovePaymentMethodsFromChannel($input: RemovePaymentMethodsFromChannelInput!) {
        removePaymentMethodsFromChannel(input: $input) {
            id
            name
        }
    }
`;
export const assignPaymentMethodsToChannelBulkAction = createBulkAssignToChannelAction<
    ItemOf<GetPaymentMethodListQuery, 'paymentMethods'>
>({
    location: 'payment-method-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdatePaymentMethod) ||
        userPermissions.includes(Permission.UpdateSettings),
    getItemName: item => item.name,
    bulkAssignToChannel: (dataService, paymentMethodIds, channelIds) =>
        channelIds.map(channelId =>
            dataService
                .mutate(AssignPaymentMethodsToChannelDocument, {
                    input: {
                        channelId,
                        paymentMethodIds,
                    },
                })
                .pipe(map(res => res.assignPaymentMethodsToChannel)),
        ),
});

export const removePaymentMethodsFromChannelBulkAction = createBulkRemoveFromChannelAction<
    ItemOf<GetPaymentMethodListQuery, 'paymentMethods'>
>({
    location: 'payment-method-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeletePaymentMethod) ||
        userPermissions.includes(Permission.DeleteSettings),
    getItemName: item => item.name,
    bulkRemoveFromChannel: (dataService, paymentMethodIds, channelId) =>
        dataService
            .mutate(RemovePaymentMethodsFromChannelDocument, {
                input: {
                    channelId,
                    paymentMethodIds,
                },
            })
            .pipe(map(res => res.removePaymentMethodsFromChannel)),
});
