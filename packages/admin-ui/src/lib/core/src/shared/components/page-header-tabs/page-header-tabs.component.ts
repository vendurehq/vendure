import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { IsActiveMatchOptions } from '@angular/router';

export interface HeaderTab {
    id: string;
    label: string;
    icon?: string;
    route?: string[];
}

@Component({
    selector: 'vdr-page-header-tabs',
    templateUrl: './page-header-tabs.component.html',
    styleUrls: ['./page-header-tabs.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PageHeaderTabsComponent {
    @Input() tabs: HeaderTab[] = [];

    readonly routerLinkActiveOptions: IsActiveMatchOptions = {
        matrixParams: 'ignored',
        queryParams: 'ignored',
        fragment: 'ignored',
        paths: 'exact',
    };
}
