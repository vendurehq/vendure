import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';
import { Observable } from 'rxjs';

import { FormInputComponent } from '../../../common/component-registry-types';
import { CustomFieldConfigFragment, LanguageCode } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

/**
 * @description
 * Uses a select input to allow the selection of a string value. Should be used with
 * `string` type fields with options.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-select-form-input',
    templateUrl: './select-form-input.component.html',
    styleUrls: ['./select-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class SelectFormInputComponent implements FormInputComponent, OnInit {
    static readonly id: DefaultFormComponentId = 'select-form-input';
    @Input() readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'select-form-input'> & CustomFieldConfigFragment;
    uiLanguage$: Observable<LanguageCode>;

    get options() {
        return this.config.ui?.options || this.config.options;
    }

    constructor(private dataService: DataService) {}

    ngOnInit() {
        this.uiLanguage$ = this.dataService.client.uiState().mapStream(({ uiState }) => uiState.language);
    }

    trackByFn(index: number, item: any) {
        return item.value;
    }
}
