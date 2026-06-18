import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent, InputComponentConfig } from '../../../common/component-registry-types';

/**
 * @description
 * Uses textarea form input. This is the default input for `text` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-textarea-form-input',
    templateUrl: './textarea-form-input.component.html',
    styleUrls: ['./textarea-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class TextareaFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'textarea-form-input';
    readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'textarea-form-input'>;

    get spellcheck(): boolean {
        return this.config.spellcheck === true;
    }
}
