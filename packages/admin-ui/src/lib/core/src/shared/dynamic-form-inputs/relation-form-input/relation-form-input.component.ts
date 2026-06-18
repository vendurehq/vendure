import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent } from '../../../common/component-registry-types';
import { RelationCustomFieldConfig } from '../../../common/generated-types';

/**
 * @description
 * The default input component for `relation` type custom fields. Allows the selection
 * of a ProductVariant, Product, Customer or Asset. For other entity types, a custom
 * implementation will need to be defined. See {@link registerFormInputComponent}.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-relation-form-input',
    templateUrl: './relation-form-input.component.html',
    styleUrls: ['./relation-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class RelationFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'relation-form-input';
    @Input() readonly: boolean;
    formControl: UntypedFormControl;
    config: RelationCustomFieldConfig;
}
