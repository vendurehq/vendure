import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent, InputComponentConfig } from '../../../common/component-registry-types';

/**
 * @description
 * Uses the {@link RichTextEditorComponent} as in input for `text` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-rich-text-form-input',
    templateUrl: './rich-text-form-input.component.html',
    styleUrls: ['./rich-text-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class RichTextFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'rich-text-form-input';
    readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'rich-text-form-input'>;
}
