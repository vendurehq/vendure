import { createBulkDeleteAction, GetRolesQuery, ItemOf, Permission } from '@vendure/admin-ui/core';
import { map } from 'rxjs/operators';

export const deleteRolesBulkAction = createBulkDeleteAction<ItemOf<GetRolesQuery, 'roles'>>({
    location: 'role-list',
    requiresPermission: userPermissions => userPermissions.includes(Permission.DeleteAdministrator),
    getItemName: item => item.description,
    bulkDelete: (dataService, ids) =>
        dataService.administrator.deleteRoles(ids).pipe(map(res => res.deleteRoles)),
});
