import { Component } from '@angular/core';
import { DataTable2ColumnComponent } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-order-total-column',
    template: ``,
    exportAs: 'row',
    standalone: false,
})
export class OrderTotalColumnComponent<T> extends DataTable2ColumnComponent<T> {
    orderable = false;
}
