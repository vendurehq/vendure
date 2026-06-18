import { Component } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { map } from 'rxjs/operators';
import { BreadcrumbService } from '../../providers/breadcrumb/breadcrumb.service';

/**
 * A breadcrumbs component which reads the route config and any route that has a `data.breadcrumb` property will
 * be displayed in the breadcrumb trail.
 *
 * The `breadcrumb` property can be a string or a function. If a function, it will be passed the route's `data`
 * object (which will include all resolved keys) and any route params, and should return a BreadcrumbValue.
 *
 * See the test config to get an idea of allowable configs for breadcrumbs.
 */
@Component({
    selector: 'vdr-breadcrumb',
    templateUrl: './breadcrumb.component.html',
    styleUrls: ['./breadcrumb.component.scss'],
    standalone: false,
})
export class BreadcrumbComponent {
    breadcrumbs$: Observable<Array<{ link: string | any[]; label: string }>>;
    parentBreadcrumb$: Observable<{ link: string | any[]; label: string } | undefined>;
    private destroy$ = new Subject<void>();

    constructor(private breadcrumbService: BreadcrumbService) {
        this.breadcrumbs$ = this.breadcrumbService.breadcrumbs$;
        this.parentBreadcrumb$ = this.breadcrumbService.breadcrumbs$.pipe(
            map(breadcrumbs => (1 < breadcrumbs.length ? breadcrumbs[breadcrumbs.length - 2] : undefined)),
        );
    }
}
