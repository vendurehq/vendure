import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent } from '../../../common/component-registry-types';

/**
 * @description
 * Displays a number input. Default input for `int` and `float` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-number-form-input',
    templateUrl: './number-form-input.component.html',
    styleUrls: ['./number-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class NumberFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'number-form-input';
    @Input() readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'number-form-input'>;

    get prefix() {
        return this.config.ui?.prefix || this.config.prefix;
    }
    get suffix() {
        return this.config.ui?.suffix || this.config.suffix;
    }
    get min() {
        return this.config.ui?.min || this.config.min;
    }
    get max() {
        return this.config.ui?.max || this.config.max;
    }
    get step() {
        return this.config.ui?.step || this.config.step;
    }
}
