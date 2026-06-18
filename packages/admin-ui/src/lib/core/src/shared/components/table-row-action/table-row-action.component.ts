import { Component, Input, OnInit } from '@angular/core';

/**
 * A button link to be used as actions in rows of a table.
 */
@Component({
    selector: 'vdr-table-row-action',
    templateUrl: './table-row-action.component.html',
    styleUrls: ['./table-row-action.component.scss'],
    standalone: false,
})
export class TableRowActionComponent {
    @Input() linkTo: any[];
    @Input() label: string;
    @Input() iconShape: string;
    @Input() disabled = false;
}
