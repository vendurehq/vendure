import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { from, merge, Observable, of, Subject, switchMap } from 'rxjs';
import { LanguageCode, LocalizedString } from '../../../common/generated-types';
import { DataTableFilter } from '../../../providers/data-table/data-table-filter';
import { FilterWithValue } from '../../../providers/data-table/data-table-filter-collection';

@Component({
    selector: 'vdr-data-table-filter-label',
    templateUrl: './data-table-filter-label.component.html',
    styleUrls: ['./data-table-filter-label.component.scss'],
    changeDetection: ChangeDetectionStrategy.Default,
    standalone: false,
})
export class DataTableFilterLabelComponent implements OnInit {
    @Input() filterWithValue: FilterWithValue;
    protected customFilterLabel$?: Observable<string>;

    ngOnInit() {
        const filterValueUpdate$ = new Subject<void>();
        this.filterWithValue.onUpdate(() => filterValueUpdate$.next());
        this.customFilterLabel$ = merge(of(this.filterWithValue), filterValueUpdate$).pipe(
            switchMap(() => {
                if (this.filterWithValue?.filter.type.kind === 'custom') {
                    const labelResult = this.filterWithValue.filter.type.getLabel(this.filterWithValue.value);
                    return typeof labelResult === 'string' ? of(labelResult) : from(labelResult);
                } else {
                    return of('');
                }
            }),
        );
    }
}
