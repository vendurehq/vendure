import { createBulkDeleteAction, GetCustomerGroupsQuery, ItemOf, Permission } from '@vendure/admin-ui/core';
import { map } from 'rxjs/operators';

export const deleteCustomerGroupsBulkAction = createBulkDeleteAction<
    ItemOf<GetCustomerGroupsQuery, 'customerGroups'>
>({
    location: 'customer-group-list',
    requiresPermission: userPermissions => userPermissions.includes(Permission.DeleteCustomerGroup),
    getItemName: item => item.name,
    bulkDelete: (dataService, ids) =>
        dataService.customer.deleteCustomerGroups(ids).pipe(map(res => res.deleteCustomerGroups)),
});
