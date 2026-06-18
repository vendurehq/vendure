import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

import { FormInputComponent } from '../../../common/component-registry-types';
import { LanguageCode, StructCustomFieldFragment } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

/**
 * @description
 * A checkbox input. The default input component for `boolean` fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-struct-form-input',
    templateUrl: './struct-form-input.component.html',
    styleUrls: ['./struct-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class StructFormInputComponent implements FormInputComponent, OnInit, OnDestroy {
    static readonly id: DefaultFormComponentId = 'struct-form-input';
    readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'struct-form-input'>;
    uiLanguage$: Observable<LanguageCode>;
    protected structFormGroup = new FormGroup({});
    protected fields: Array<{
        def: StructCustomFieldFragment['fields'][number];
        formControl: FormControl;
    }>;
    private subscription: Subscription;

    constructor(private dataService: DataService) {}

    ngOnInit() {
        this.uiLanguage$ = this.dataService.client
            .uiState()
            .stream$.pipe(map(({ uiState }) => uiState.language));

        const value = this.formControl.value || {};

        this.fields =
            (this.config as unknown as StructCustomFieldFragment).fields?.map(field => {
                const formControl = new FormControl(value[field.name]);
                this.structFormGroup.addControl(field.name, formControl);
                return { def: field, formControl };
            }) ?? [];

        this.structFormGroup.valueChanges.subscribe(value => {
            this.formControl.setValue(value);
            this.formControl.markAsDirty();
        });
    }

    ngOnDestroy() {
        this.subscription?.unsubscribe();
    }
}
