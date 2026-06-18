import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import {
    CreateCustomerGroupInput,
    CustomFieldConfig,
    Dialog,
    getCustomFieldsDefaults,
    ServerConfigService,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-customer-group-detail-dialog',
    templateUrl: './customer-group-detail-dialog.component.html',
    styleUrls: ['./customer-group-detail-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CustomerGroupDetailDialogComponent implements Dialog<CreateCustomerGroupInput>, OnInit {
    group: { id?: string; name: string; customFields?: { [name: string]: any } };
    resolveWith: (result?: CreateCustomerGroupInput) => void;
    customFields: CustomFieldConfig[];
    form: UntypedFormGroup;

    constructor(
        private serverConfigService: ServerConfigService,
        private formBuilder: UntypedFormBuilder,
    ) {
        this.customFields = this.serverConfigService.getCustomFieldsFor('CustomerGroup');
    }

    ngOnInit() {
        this.form = this.formBuilder.group({
            name: [this.group.name, Validators.required],
            customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
        });
        if (this.customFields.length) {
            const customFieldsGroup = this.form.get('customFields') as UntypedFormGroup;

            for (const fieldDef of this.customFields) {
                const key = fieldDef.name;
                const value = this.group.customFields?.[key];
                const control = customFieldsGroup.get(key);
                if (control) {
                    control.patchValue(value);
                }
            }
        }
    }

    cancel() {
        this.resolveWith();
    }

    save() {
        this.resolveWith(this.form.value);
    }
}
