import { createBulkDeleteAction, GetZoneListQuery, ItemOf, Permission } from '@vendure/admin-ui/core';
import { map } from 'rxjs/operators';

export const deleteZonesBulkAction = createBulkDeleteAction<ItemOf<GetZoneListQuery, 'zones'>>({
    location: 'zone-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteSettings) ||
        userPermissions.includes(Permission.DeleteZone),
    getItemName: item => item.name,
    bulkDelete: (dataService, ids) => dataService.settings.deleteZones(ids).pipe(map(res => res.deleteZones)),
});
