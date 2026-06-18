import { registerFormInputComponent } from '../../extension/register-form-input-component';

import { BooleanFormInputComponent } from './boolean-form-input/boolean-form-input.component';
import { HtmlEditorFormInputComponent } from './code-editor-form-input/html-editor-form-input.component';
import { JsonEditorFormInputComponent } from './code-editor-form-input/json-editor-form-input.component';
import { CombinationModeFormInputComponent } from './combination-mode-form-input/combination-mode-form-input.component';
import { CurrencyFormInputComponent } from './currency-form-input/currency-form-input.component';
import { CustomerGroupFormInputComponent } from './customer-group-form-input/customer-group-form-input.component';
import { DateFormInputComponent } from './date-form-input/date-form-input.component';
import { FacetValueFormInputComponent } from './facet-value-form-input/facet-value-form-input.component';
import { NumberFormInputComponent } from './number-form-input/number-form-input.component';
import { PasswordFormInputComponent } from './password-form-input/password-form-input.component';
import { ProductMultiSelectorFormInputComponent } from './product-multi-selector-form-input/product-multi-selector-form-input.component';
import { ProductSelectorFormInputComponent } from './product-selector-form-input/product-selector-form-input.component';
import { RelationFormInputComponent } from './relation-form-input/relation-form-input.component';
import { RichTextFormInputComponent } from './rich-text-form-input/rich-text-form-input.component';
import { SelectFormInputComponent } from './select-form-input/select-form-input.component';
import { StructFormInputComponent } from './struct-form-input/struct-form-input.component';
import { TextFormInputComponent } from './text-form-input/text-form-input.component';
import { TextareaFormInputComponent } from './textarea-form-input/textarea-form-input.component';

export const defaultFormInputs = [
    BooleanFormInputComponent,
    CurrencyFormInputComponent,
    DateFormInputComponent,
    FacetValueFormInputComponent,
    NumberFormInputComponent,
    SelectFormInputComponent,
    TextFormInputComponent,
    ProductSelectorFormInputComponent,
    CustomerGroupFormInputComponent,
    PasswordFormInputComponent,
    RelationFormInputComponent,
    TextareaFormInputComponent,
    RichTextFormInputComponent,
    JsonEditorFormInputComponent,
    HtmlEditorFormInputComponent,
    ProductMultiSelectorFormInputComponent,
    CombinationModeFormInputComponent,
    StructFormInputComponent,
];

/**
 * Registers the default form input components.
 */
export function registerDefaultFormInputs() {
    return defaultFormInputs.map(cmp => registerFormInputComponent(cmp.id, cmp));
}
