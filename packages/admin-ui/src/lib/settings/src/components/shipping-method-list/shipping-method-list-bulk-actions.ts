import {
    createBulkAssignToChannelAction,
    createBulkDeleteAction,
    createBulkRemoveFromChannelAction,
    GetShippingMethodListQuery,
    GetRolesQuery,
    ItemOf,
    Permission,
    AssignShippingMethodsToChannelDocument,
    RemoveShippingMethodsFromChannelDocument,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { map } from 'rxjs/operators';

export const deleteShippingMethodsBulkAction = createBulkDeleteAction<
    ItemOf<GetShippingMethodListQuery, 'shippingMethods'>
>({
    location: 'shipping-method-list',
    requiresPermission: userPermissions => userPermissions.includes(Permission.DeleteShippingMethod),
    getItemName: item => item.name,
    bulkDelete: (dataService, ids) =>
        dataService.shippingMethod.deleteShippingMethods(ids).pipe(map(res => res.deleteShippingMethods)),
});

const ASSIGN_SHIPPING_METHODS_TO_CHANNEL = gql`
    mutation AssignShippingMethodsToChannel($input: AssignShippingMethodsToChannelInput!) {
        assignShippingMethodsToChannel(input: $input) {
            id
            name
        }
    }
`;

const REMOVE_SHIPPING_METHODS_FROM_CHANNEL = gql`
    mutation RemoveShippingMethodsFromChannel($input: RemoveShippingMethodsFromChannelInput!) {
        removeShippingMethodsFromChannel(input: $input) {
            id
            name
        }
    }
`;
export const assignShippingMethodsToChannelBulkAction = createBulkAssignToChannelAction<
    ItemOf<GetShippingMethodListQuery, 'shippingMethods'>
>({
    location: 'shipping-method-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateShippingMethod) ||
        userPermissions.includes(Permission.UpdateSettings),
    getItemName: item => item.name,
    bulkAssignToChannel: (dataService, shippingMethodIds, channelIds) =>
        channelIds.map(channelId =>
            dataService
                .mutate(AssignShippingMethodsToChannelDocument, {
                    input: {
                        channelId,
                        shippingMethodIds,
                    },
                })
                .pipe(map(res => res.assignShippingMethodsToChannel)),
        ),
});

export const removeShippingMethodsFromChannelBulkAction = createBulkRemoveFromChannelAction<
    ItemOf<GetShippingMethodListQuery, 'shippingMethods'>
>({
    location: 'shipping-method-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteShippingMethod) ||
        userPermissions.includes(Permission.DeleteSettings),
    getItemName: item => item.name,
    bulkRemoveFromChannel: (dataService, shippingMethodIds, channelId) =>
        dataService
            .mutate(RemoveShippingMethodsFromChannelDocument, {
                input: {
                    channelId,
                    shippingMethodIds,
                },
            })
            .pipe(map(res => res.removeShippingMethodsFromChannel)),
});
