import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
    selector: 'vdr-page-entity-info',
    templateUrl: './page-entity-info.component.html',
    styleUrls: ['./page-entity-info.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PageEntityInfoComponent {
    @Input() entity: { id: string; createdAt?: string; updatedAt?: string };
}
