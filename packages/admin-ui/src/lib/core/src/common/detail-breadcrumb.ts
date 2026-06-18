import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { Observable } from 'rxjs';
import { map, take } from 'rxjs/operators';

import { BreadcrumbValue } from '../providers/breadcrumb/breadcrumb.service';

/**
 * Creates an observable of breadcrumb links for use in the route config of a detail route.
 */
export function detailBreadcrumb<T>(options: {
    entity: Observable<T>;
    id: string;
    breadcrumbKey: string;
    getName: (entity: T) => string;
    route: string;
}): Observable<BreadcrumbValue> {
    return options.entity.pipe(
        map(entity => {
            let label = '';
            if (options.id === 'create') {
                label = 'common.create';
            } else {
                label = `${options.getName(entity)}`;
            }
            return [
                {
                    label: options.breadcrumbKey,
                    link: ['../', options.route],
                },
                {
                    label,
                    link: [options.route, options.id],
                },
            ];
        }),
    );
}
