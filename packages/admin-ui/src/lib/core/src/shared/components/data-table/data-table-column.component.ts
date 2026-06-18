import { Component, Input, OnInit, TemplateRef, ViewChild } from '@angular/core';

@Component({
    selector: 'vdr-dt-column',
    template: `
        <ng-template><ng-content></ng-content></ng-template>
    `,
    standalone: false,
})
export class DataTableColumnComponent {
    /**
     * When set to true, this column will expand to use avaiable width
     */
    @Input() expand = false;
    @ViewChild(TemplateRef, { static: true }) template: TemplateRef<any>;
}
