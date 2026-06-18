import { Component, ContentChild, Input, OnInit, TemplateRef, ViewChild } from '@angular/core';
import { FormControl } from '@angular/forms';

@Component({
    selector: 'vdr-dt2-search',
    templateUrl: `./data-table-search.component.html`,
    styleUrls: ['./data-table-search.component.scss'],
    standalone: false,
})
export class DataTable2SearchComponent {
    @Input() searchTermControl: FormControl<string>;
    @Input() searchTermPlaceholder: string | undefined;
    @ViewChild(TemplateRef, { static: true }) template: TemplateRef<any>;
}
