import { createBulkDeleteAction, GetTaxRateListQuery, ItemOf, Permission } from '@vendure/admin-ui/core';
import { map } from 'rxjs/operators';

export const deleteTaxRatesBulkAction = createBulkDeleteAction<ItemOf<GetTaxRateListQuery, 'taxRates'>>({
    location: 'tax-rate-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteSettings) ||
        userPermissions.includes(Permission.DeleteTaxRate),
    getItemName: item => item.name,
    bulkDelete: (dataService, ids) =>
        dataService.settings.deleteTaxRates(ids).pipe(map(res => res.deleteTaxRates)),
});
