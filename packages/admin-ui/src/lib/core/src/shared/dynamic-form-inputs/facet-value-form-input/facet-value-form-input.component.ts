import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent, InputComponentConfig } from '../../../common/component-registry-types';
import { FacetValueFragment } from '../../../common/generated-types';

/**
 * @description
 * Allows the selection of multiple FacetValues via an autocomplete select input.
 * Should be used with `ID` type **list** fields which represent FacetValue IDs.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-facet-value-form-input',
    templateUrl: './facet-value-form-input.component.html',
    styleUrls: ['./facet-value-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class FacetValueFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'facet-value-form-input';
    readonly isListInput = true;
    readonly: boolean;
    formControl: UntypedFormControl;
    config: InputComponentConfig;

    valueTransformFn = (values: FacetValueFragment[]) => {
        const isUsedInConfigArg = this.config.__typename === 'ConfigArgDefinition';
        if (isUsedInConfigArg) {
            return JSON.stringify(values.map(s => s.id));
        } else {
            return values;
        }
    };
}
