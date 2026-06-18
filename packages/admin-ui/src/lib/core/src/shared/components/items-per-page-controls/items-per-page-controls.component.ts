import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

/**
 * A control for setting the number of items per page in a paginated list.
 */
@Component({
    selector: 'vdr-items-per-page-controls',
    templateUrl: './items-per-page-controls.component.html',
    styleUrls: ['./items-per-page-controls.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ItemsPerPageControlsComponent {
    @Input() itemsPerPage = 10;
    @Output() itemsPerPageChange = new EventEmitter<number>();
}
