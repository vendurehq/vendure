import {
    AssignStockLocationsToChannelDocument,
    createBulkAssignToChannelAction,
    createBulkDeleteAction,
    createBulkRemoveFromChannelAction,
    DeleteStockLocationsDocument,
    DeletionResult,
    GetStockLocationListQuery,
    ItemOf,
    Permission,
    RemoveStockLocationsFromChannelDocument,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { map } from 'rxjs/operators';

const DELETE_STOCK_LOCATIONS = gql`
    mutation DeleteStockLocations($input: [DeleteStockLocationInput!]!) {
        deleteStockLocations(input: $input) {
            result
            message
        }
    }
`;

const ASSIGN_STOCK_LOCATIONS_TO_CHANNEL = gql`
    mutation AssignStockLocationsToChannel($input: AssignStockLocationsToChannelInput!) {
        assignStockLocationsToChannel(input: $input) {
            id
            name
        }
    }
`;

const REMOVE_STOCK_LOCATIONS_FROM_CHANNEL = gql`
    mutation RemoveStockLocationsFromChannel($input: RemoveStockLocationsFromChannelInput!) {
        removeStockLocationsFromChannel(input: $input) {
            id
            name
        }
    }
`;

export const deleteStockLocationsBulkAction = createBulkDeleteAction<
    ItemOf<GetStockLocationListQuery, 'stockLocations'>
>({
    location: 'stock-location-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteStockLocation) ||
        userPermissions.includes(Permission.DeleteCatalog),
    getItemName: item => item.name,
    bulkDelete: (dataService, ids) =>
        dataService
            .mutate(DeleteStockLocationsDocument, {
                input: ids.map(id => ({ id })),
            })
            .pipe(map(res => res.deleteStockLocations)),
    shouldRetryItem: response => response.result === DeletionResult.NOT_DELETED,
});

export const assignStockLocationsToChannelBulkAction = createBulkAssignToChannelAction<
    ItemOf<GetStockLocationListQuery, 'stockLocations'>
>({
    location: 'stock-location-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateCatalog) ||
        userPermissions.includes(Permission.UpdateStockLocation),
    getItemName: item => item.name,
    bulkAssignToChannel: (dataService, stockLocationIds, channelIds) =>
        channelIds.map(channelId =>
            dataService
                .mutate(AssignStockLocationsToChannelDocument, {
                    input: {
                        channelId,
                        stockLocationIds,
                    },
                })
                .pipe(map(res => res.assignStockLocationsToChannel)),
        ),
});

export const removeStockLocationsFromChannelBulkAction = createBulkRemoveFromChannelAction<
    ItemOf<GetStockLocationListQuery, 'stockLocations'>
>({
    location: 'stock-location-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteCatalog) ||
        userPermissions.includes(Permission.DeleteStockLocation),
    getItemName: item => item.name,
    bulkRemoveFromChannel: (dataService, stockLocationIds, channelId) =>
        dataService
            .mutate(RemoveStockLocationsFromChannelDocument, {
                input: {
                    channelId,
                    stockLocationIds,
                },
            })
            .pipe(map(res => res.removeStockLocationsFromChannel)),
});
