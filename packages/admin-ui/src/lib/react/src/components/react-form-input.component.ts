import { Component, inject, InjectionToken, OnInit, ViewEncapsulation } from '@angular/core';
import { FormControl } from '@angular/forms';
import { CustomField, FormInputComponent } from '@vendure/admin-ui/core';
import { ElementType } from 'react';
import { ReactComponentHostDirective } from '../directives/react-component-host.directive';
import { ReactFormInputOptions } from '../types';

export const REACT_INPUT_COMPONENT_OPTIONS = new InjectionToken<{
    component: ElementType;
}>('REACT_INPUT_COMPONENT_OPTIONS');

@Component({
    selector: 'vdr-react-form-input-component',
    template: ` <div [vdrReactComponentHost]="reactComponent" [context]="context" [props]="context"></div> `,
    styleUrls: ['./react-global-styles.scss'],
    encapsulation: ViewEncapsulation.None,
    imports: [ReactComponentHostDirective]
})
export class ReactFormInputComponent implements FormInputComponent, OnInit {
    static readonly id: string = 'react-form-input-component';
    readonly: boolean;
    formControl: FormControl;
    config: CustomField & Record<string, any>;

    protected context: ReactFormInputOptions;

    protected reactComponent = inject(REACT_INPUT_COMPONENT_OPTIONS).component;

    ngOnInit() {
        this.context = {
            formControl: this.formControl,
            readonly: this.readonly,
            config: this.config,
        };
    }
}
