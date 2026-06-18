import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent } from '../../../common/component-registry-types';

/**
 * @description
 * Allows selection of a datetime. Default input for `datetime` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-date-form-input',
    templateUrl: './date-form-input.component.html',
    styleUrls: ['./date-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DateFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'date-form-input';
    @Input() readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'date-form-input'>;
    get min() {
        return this.config.ui?.min || this.config.min;
    }
    get max() {
        return this.config.ui?.max || this.config.max;
    }
    get yearRange() {
        return this.config.ui?.yearRange || this.config.yearRange;
    }
}
