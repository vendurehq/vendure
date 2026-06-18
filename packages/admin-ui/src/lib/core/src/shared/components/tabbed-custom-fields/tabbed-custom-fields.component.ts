import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { CustomFieldConfig } from '../../../common/generated-types';
import { CustomFieldEntityName } from '../../../providers/custom-field-component/custom-field-component.service';

export type GroupedCustomFields = Array<{ tabName: string; customFields: CustomFieldConfig[] }>;

@Component({
    selector: 'vdr-tabbed-custom-fields',
    templateUrl: './tabbed-custom-fields.component.html',
    styleUrls: ['./tabbed-custom-fields.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class TabbedCustomFieldsComponent implements OnInit {
    @Input() entityName: CustomFieldEntityName;
    @Input() customFields: CustomFieldConfig[];
    @Input() customFieldsFormGroup: AbstractControl;
    @Input() readonly = false;
    @Input() compact = false;
    @Input() showLabel = true;
    readonly defaultTabName = '__default_tab__';
    tabbedCustomFields: GroupedCustomFields;

    ngOnInit(): void {
        this.tabbedCustomFields = this.groupByTabs(this.customFields);
    }

    customFieldIsSet(name: string): boolean {
        return !!this.customFieldsFormGroup?.get(name);
    }

    componentShouldSpanGrid(customField: CustomFieldConfig): boolean {
        const smallComponents: DefaultFormComponentId[] = [
            'boolean-form-input',
            'currency-form-input',
            'date-form-input',
            'number-form-input',
            'password-form-input',
            'select-form-input',
            'text-form-input',
            'relation-form-input',
        ];
        return (
            customField.type === 'text' ||
            customField.type === 'localeText' ||
            customField.type === 'relation' ||
            customField.type === 'struct' ||
            (customField.ui?.component && !smallComponents.includes(customField.ui?.component))
        );
    }

    private groupByTabs(customFieldConfigs: CustomFieldConfig[]): GroupedCustomFields {
        const tabMap = new Map<string, CustomFieldConfig[]>();
        for (const field of customFieldConfigs) {
            const tabName = field.ui?.tab ?? this.defaultTabName;
            if (tabMap.has(tabName)) {
                tabMap.get(tabName)?.push(field);
            } else {
                tabMap.set(tabName, [field]);
            }
        }
        return Array.from(tabMap.entries())
            .sort((a, b) => (a[0] === this.defaultTabName ? -1 : 1))
            .map(([tabName, customFields]) => ({ tabName, customFields }));
    }
}
