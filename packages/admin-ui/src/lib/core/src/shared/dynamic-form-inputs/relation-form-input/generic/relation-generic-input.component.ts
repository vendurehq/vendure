import { ChangeDetectionStrategy, Component, Input, TemplateRef, ViewChild } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';

import { RelationCustomFieldConfig } from '../../../../common/generated-types';
import { ModalService } from '../../../../providers/modal/modal.service';
import { RelationSelectorDialogComponent } from '../relation-selector-dialog/relation-selector-dialog.component';

@Component({
    selector: 'vdr-relation-generic-input',
    templateUrl: './relation-generic-input.component.html',
    styleUrls: ['./relation-generic-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class RelationGenericInputComponent {
    @Input() readonly: boolean;
    @Input() parentFormControl: UntypedFormControl;
    @Input() config: RelationCustomFieldConfig;
    relationId: string;

    @ViewChild('selector') template: TemplateRef<any>;

    constructor(private modalService: ModalService) {}

    selectRelationId() {
        this.modalService
            .fromComponent(RelationSelectorDialogComponent, {
                size: 'md',
                closable: true,
                locals: {
                    title: _('common.select-relation-id'),
                    selectorTemplate: this.template,
                },
            })
            .subscribe(result => {
                if (result) {
                    this.parentFormControl.setValue({ id: result });
                    this.parentFormControl.markAsDirty();
                }
            });
    }

    remove() {
        this.parentFormControl.setValue(null);
        this.parentFormControl.markAsDirty();
    }
}
