import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'vdr-page-detail-layout',
    templateUrl: './page-detail-layout.component.html',
    styleUrls: ['./page-detail-layout.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PageDetailLayoutComponent {}
