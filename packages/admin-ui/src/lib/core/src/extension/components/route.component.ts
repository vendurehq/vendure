import { Component, inject, InjectionToken, Input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { combineLatest, Observable, of, switchMap } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { BreadcrumbValue } from '../../providers/breadcrumb/breadcrumb.service';
import { SharedModule } from '../../shared/shared.module';
import { PageMetadataService } from '../providers/page-metadata.service';
import { AngularRouteComponentOptions } from '../types';
import { HeaderTab } from '../../shared/components/page-header-tabs/page-header-tabs.component';
import { PageService } from '../../providers/page/page.service';
import { PageLocationId } from '../../common/component-registry-types';

export const ROUTE_COMPONENT_OPTIONS = new InjectionToken<AngularRouteComponentOptions>(
    'ROUTE_COMPONENT_OPTIONS',
);

@Component({
    selector: 'vdr-route-component',
    template: `
        <vdr-page-header>
            <vdr-page-title *ngIf="title$ | async as title" [title]="title"></vdr-page-title>
            <vdr-page-header-description *ngIf="description">{{ description }}</vdr-page-header-description>
            <vdr-page-header-tabs *ngIf="headerTabs.length > 1" [tabs]="headerTabs"></vdr-page-header-tabs>
        </vdr-page-header>
        <vdr-page-body><ng-content /></vdr-page-body>
    `,
    imports: [SharedModule],
    providers: [PageMetadataService],
})
export class RouteComponent {
    protected title$: Observable<string | undefined>;
    @Input() protected locationId: PageLocationId;
    @Input() protected description: string;
    headerTabs: HeaderTab[] = [];

    constructor(
        private route: ActivatedRoute,
        private pageService: PageService,
    ) {
        const breadcrumbLabel$ = this.route.data.pipe(
            switchMap(data => {
                if (data.breadcrumb instanceof Observable) {
                    return data.breadcrumb as Observable<BreadcrumbValue>;
                }
                if (typeof data.breadcrumb === 'function') {
                    return data.breadcrumb(data) as Observable<BreadcrumbValue>;
                }
                return of(undefined);
            }),
            filter(notNullOrUndefined),
            map(breadcrumb => {
                if (typeof breadcrumb === 'string') {
                    return breadcrumb;
                }
                if (Array.isArray(breadcrumb)) {
                    return breadcrumb[breadcrumb.length - 1].label;
                }
                return breadcrumb.label;
            }),
        );

        this.title$ = combineLatest([inject(ROUTE_COMPONENT_OPTIONS).title$, breadcrumbLabel$]).pipe(
            map(([title, breadcrumbLabel]) => title ?? breadcrumbLabel),
        );

        this.locationId = this.route.snapshot.data.locationId;
        this.description = this.route.snapshot.data.description;
        this.headerTabs = this.pageService.getPageTabs(this.locationId).map(tab => ({
            id: tab.tab,
            label: tab.tab,
            icon: tab.tabIcon,
            route: tab.route ? [tab.route] : ['./'],
        }));
    }
}
