import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
    selector: 'vdr-page-block',
    templateUrl: './page-block.component.html',
    styleUrls: ['./page-block.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PageBlockComponent {}
