import { Component, ContentChild, Input, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CustomFieldConfig, LanguageCode } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';
import { DataTableSortCollection } from '../../../providers/data-table/data-table-sort-collection';
import { CustomFieldLabelPipe } from '../../pipes/custom-field-label.pipe';
import { DataTable2ColumnComponent } from './data-table-column.component';

const labelPipe = new CustomFieldLabelPipe();

@Component({
    selector: 'vdr-dt2-custom-field-column',
    templateUrl: './data-table-custom-field-column.component.html',
    styleUrls: ['./data-table-custom-field-column.component.scss'],
    exportAs: 'row',
    standalone: false,
})
export class DataTableCustomFieldColumnComponent<T> extends DataTable2ColumnComponent<T> implements OnInit {
    @Input() customField: CustomFieldConfig;
    @Input() sorts?: DataTableSortCollection<any, any[]>;
    @ViewChild(TemplateRef, { static: false }) template: TemplateRef<any>;
    protected uiLanguage$: Observable<LanguageCode>;
    constructor(protected dataService: DataService) {
        super();
        this.uiLanguage$ = this.dataService.client
            .uiState()
            .stream$.pipe(map(({ uiState }) => uiState.language));
    }

    ngOnInit() {
        this.uiLanguage$.subscribe(uiLanguage => {
            this.heading =
                Array.isArray(this.customField.label) && this.customField.label.length > 0
                    ? (this.customField.label.find(l => l.languageCode === uiLanguage)?.value ??
                      this.customField.name)
                    : this.customField.name;
        });
        this.hiddenByDefault = true;
        this.sort = this.sorts?.get(this.customField.name);
        this.id = this.customField.name;
        this.heading = labelPipe.transform(this.customField, null);
        super.ngOnInit();
    }
}
