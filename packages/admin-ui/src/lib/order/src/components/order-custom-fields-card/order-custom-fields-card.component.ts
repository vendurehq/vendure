import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { CustomFieldConfig, ModalService } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-order-custom-fields-card',
    templateUrl: './order-custom-fields-card.component.html',
    styleUrls: ['./order-custom-fields-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderCustomFieldsCardComponent implements OnInit {
    @Input() customFieldsConfig: CustomFieldConfig[] = [];
    @Input() customFieldValues: { [name: string]: any } = {};
    @Output() updateClick = new EventEmitter<any>();
    customFieldForm: UntypedFormGroup;
    editable = false;
    constructor(
        private formBuilder: UntypedFormBuilder,
        private modalService: ModalService,
    ) {}

    ngOnInit() {
        this.customFieldForm = this.formBuilder.group({});
        for (const field of this.customFieldsConfig) {
            this.customFieldForm.addControl(
                field.name,
                this.formBuilder.control(this.customFieldValues[field.name]),
            );
        }
    }

    onUpdateClick() {
        this.updateClick.emit(this.customFieldForm.value);
        this.customFieldForm.markAsPristine();
        this.editable = false;
    }

    onCancelClick() {
        if (this.customFieldForm.dirty) {
            this.modalService
                .dialog({
                    title: _('catalog.confirm-cancel'),
                    buttons: [
                        { type: 'secondary', label: _('common.keep-editing') },
                        { type: 'danger', label: _('common.discard-changes'), returnValue: true },
                    ],
                })
                .subscribe(result => {
                    if (result) {
                        this.customFieldForm.reset();
                        this.customFieldForm.markAsPristine();
                        this.editable = false;
                    }
                });
        } else {
            this.editable = false;
        }
    }
}
