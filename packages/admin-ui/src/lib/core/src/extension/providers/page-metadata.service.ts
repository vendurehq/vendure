import { inject, Injectable } from '@angular/core';
import { BreadcrumbValue } from '../../providers/breadcrumb/breadcrumb.service';
import { ROUTE_COMPONENT_OPTIONS } from '../components/route.component';

@Injectable()
export class PageMetadataService {
    private readonly routeComponentOptions = inject(ROUTE_COMPONENT_OPTIONS);

    setTitle(title: string) {
        this.routeComponentOptions.title$.next(title);
    }

    setBreadcrumbs(value: BreadcrumbValue) {
        this.routeComponentOptions.breadcrumb$.next(value);
    }
}
