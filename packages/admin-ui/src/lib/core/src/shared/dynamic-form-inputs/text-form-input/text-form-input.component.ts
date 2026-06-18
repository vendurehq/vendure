import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent, InputComponentConfig } from '../../../common/component-registry-types';

/**
 * @description
 * Uses a regular text form input. This is the default input for `string` and `localeString` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-text-form-input',
    templateUrl: './text-form-input.component.html',
    styleUrls: ['./text-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class TextFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'text-form-input';
    readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'text-form-input'>;

    get prefix() {
        return this.config.ui?.prefix || this.config.prefix;
    }

    get suffix() {
        return this.config.ui?.suffix || this.config.suffix;
    }
}
