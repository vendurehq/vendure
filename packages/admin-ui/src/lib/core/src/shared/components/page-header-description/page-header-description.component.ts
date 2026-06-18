import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'vdr-page-header-description',
    templateUrl: './page-header-description.component.html',
    styleUrls: ['./page-header-description.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PageHeaderDescriptionComponent {}
