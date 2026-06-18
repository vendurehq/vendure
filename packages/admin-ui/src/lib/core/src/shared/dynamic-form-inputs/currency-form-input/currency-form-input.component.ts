import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';
import { Observable } from 'rxjs';

import { FormInputComponent, InputComponentConfig } from '../../../common/component-registry-types';
import { CurrencyCode } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

/**
 * @description
 * An input for monetary values. Should be used with `int` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-currency-form-input',
    templateUrl: './currency-form-input.component.html',
    styleUrls: ['./currency-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CurrencyFormInputComponent implements FormInputComponent {
    static readonly id: DefaultFormComponentId = 'currency-form-input';
    @Input() readonly: boolean;
    formControl: UntypedFormControl;
    currencyCode$: Observable<CurrencyCode>;
    config: DefaultFormComponentConfig<'currency-form-input'>;

    constructor(private dataService: DataService) {
        this.currencyCode$ = this.dataService.settings
            .getActiveChannel()
            .mapStream(data => data.activeChannel.defaultCurrencyCode);
    }
}
