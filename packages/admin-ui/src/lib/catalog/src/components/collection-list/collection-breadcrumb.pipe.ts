import { Pipe, PipeTransform } from '@angular/core';
import { GetCollectionListQuery, ItemOf } from '@vendure/admin-ui/core';

/**
 * Removes the root collection and self breadcrumb from the collection breadcrumb list.
 */
@Pipe({
    name: 'collectionBreadcrumb',
    standalone: false
})
export class CollectionBreadcrumbPipe implements PipeTransform {
    transform(value: ItemOf<GetCollectionListQuery, 'collections'>): unknown {
        return value?.breadcrumbs.slice(1, -1);
    }
}
