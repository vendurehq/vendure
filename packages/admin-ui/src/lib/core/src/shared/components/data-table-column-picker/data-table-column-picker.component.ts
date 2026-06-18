import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { LanguageCode } from '../../../common/generated-types';
import { DataTable2ColumnComponent } from '../data-table-2/data-table-column.component';

@Component({
    selector: 'vdr-data-table-colum-picker',
    templateUrl: './data-table-column-picker.component.html',
    styleUrls: ['./data-table-column-picker.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DataTableColumnPickerComponent {
    @Input() columns: Array<DataTable2ColumnComponent<any>>;
    @Input() uiLanguage: LanguageCode;
    @Output() reorder = new EventEmitter<{ column: DataTable2ColumnComponent<any>; newIndex: number }>();
    @Output() resetColumns = new EventEmitter<void>();

    toggleColumn(column: DataTable2ColumnComponent<any>) {
        column.setVisibility(!column.visible);
    }

    drop(event: CdkDragDrop<Array<DataTable2ColumnComponent<any>>>) {
        this.reorder.emit({
            column: event.item.data,
            newIndex: event.currentIndex,
        });
    }

    reset() {
        this.columns.forEach(c => c.resetVisibility());
        this.resetColumns.emit();
    }
}
