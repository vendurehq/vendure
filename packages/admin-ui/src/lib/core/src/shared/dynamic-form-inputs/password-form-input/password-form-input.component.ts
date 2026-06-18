import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent, InputComponentConfig } from '../../../common/component-registry-types';

/**
 * @description
 * Displays a password text input. Should be used with `string` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-password-form-input',
    templateUrl: './password-form-input.component.html',
    styleUrls: ['./password-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class PasswordFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'password-form-input';
    readonly: boolean;
    formControl: UntypedFormControl;
    config: InputComponentConfig;
}
