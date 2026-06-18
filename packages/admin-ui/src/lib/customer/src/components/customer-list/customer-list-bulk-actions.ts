import { createBulkDeleteAction, GetCustomerListQuery, ItemOf, Permission } from '@vendure/admin-ui/core';
import { map } from 'rxjs/operators';

export const deleteCustomersBulkAction = createBulkDeleteAction<ItemOf<GetCustomerListQuery, 'customers'>>({
    location: 'customer-list',
    requiresPermission: userPermissions => userPermissions.includes(Permission.DeleteCustomer),
    getItemName: item => item.firstName + ' ' + item.lastName,
    bulkDelete: (dataService, ids) =>
        dataService.customer.deleteCustomers(ids).pipe(map(res => res.deleteCustomers)),
});
