import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, of, switchMap } from 'rxjs';
import { PageLocationId } from '../../../common/component-registry-types';
import { PageService } from '../../../providers/page/page.service';
import { HeaderTab } from '../page-header-tabs/page-header-tabs.component';

@Component({
    selector: 'vdr-page',
    templateUrl: './page.component.html',
    styleUrls: ['./page.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PageComponent {
    headerTabs: HeaderTab[] = [];
    @Input() protected locationId: PageLocationId;
    @Input() protected description: string;
    entity$: Observable<{ id: string; createdAt?: string; updatedAt?: string } | undefined>;
    constructor(
        private route: ActivatedRoute,
        private pageService: PageService,
    ) {
        this.locationId = this.route.snapshot.data.locationId;
        this.description = this.route.snapshot.data.description ?? '';
        this.headerTabs = this.pageService.getPageTabs(this.locationId).map(tab => ({
            id: tab.tab,
            label: tab.tab,
            icon: tab.tabIcon,
            route: tab.route ? [tab.route] : ['./'],
        }));
        this.entity$ = this.route.data.pipe(
            switchMap(data => (data.entity as Observable<any>) ?? of(undefined)),
        );
    }
}
