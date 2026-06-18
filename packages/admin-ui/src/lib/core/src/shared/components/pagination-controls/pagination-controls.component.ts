import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: 'vdr-pagination-controls',
    templateUrl: './pagination-controls.component.html',
    styleUrls: ['./pagination-controls.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PaginationControlsComponent {
    @Input() id?: number;
    @Input() currentPage: number;
    @Input() itemsPerPage: number;
    @Input() totalItems: number;
    @Output() pageChange = new EventEmitter<number>();
}
