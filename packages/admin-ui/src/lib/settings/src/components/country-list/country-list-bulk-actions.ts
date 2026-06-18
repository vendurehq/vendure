import { createBulkDeleteAction, GetCountryListQuery, ItemOf, Permission } from '@vendure/admin-ui/core';
import { map } from 'rxjs/operators';

export const deleteCountriesBulkAction = createBulkDeleteAction<ItemOf<GetCountryListQuery, 'countries'>>({
    location: 'country-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteSettings) ||
        userPermissions.includes(Permission.DeleteCountry),
    getItemName: item => item.name,
    bulkDelete: (dataService, ids) =>
        dataService.settings.deleteCountries(ids).pipe(map(res => res.deleteCountries)),
});
