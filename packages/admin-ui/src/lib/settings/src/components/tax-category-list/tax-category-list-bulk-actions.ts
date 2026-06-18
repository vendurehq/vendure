import { createBulkDeleteAction, GetTaxCategoryListQuery, ItemOf, Permission } from '@vendure/admin-ui/core';
import { map } from 'rxjs/operators';

export const deleteTaxCategoriesBulkAction = createBulkDeleteAction<
    ItemOf<GetTaxCategoryListQuery, 'taxCategories'>
>({
    location: 'tax-category-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteSettings) ||
        userPermissions.includes(Permission.DeleteTaxCategory),
    getItemName: item => item.name,
    bulkDelete: (dataService, ids) =>
        dataService.settings.deleteTaxCategories(ids).pipe(map(res => res.deleteTaxCategories)),
});
