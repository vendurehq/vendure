import { Component, inject, InjectionToken, OnInit, ViewEncapsulation } from '@angular/core';
import { FormGroup, UntypedFormGroup } from '@angular/forms';
import { CustomDetailComponent } from '@vendure/admin-ui/core';
import { ElementType } from 'react';
import { Observable } from 'rxjs';
import { ReactComponentHostDirective } from '../directives/react-component-host.directive';

export const REACT_CUSTOM_DETAIL_COMPONENT_OPTIONS = new InjectionToken<{
    component: ElementType;
    props?: Record<string, any>;
}>('REACT_CUSTOM_DETAIL_COMPONENT_OPTIONS');

export interface ReactCustomDetailComponentContext {
    detailForm: FormGroup;
    entity$: Observable<any>;
}

@Component({
    selector: 'vdr-react-custom-detail-component',
    template: ` <div [vdrReactComponentHost]="reactComponent" [context]="context" [props]="props"></div> `,
    styleUrls: ['./react-global-styles.scss'],
    encapsulation: ViewEncapsulation.None,
    imports: [ReactComponentHostDirective]
})
export class ReactCustomDetailComponent implements CustomDetailComponent, OnInit {
    detailForm: UntypedFormGroup;
    entity$: Observable<any>;
    protected props = inject(REACT_CUSTOM_DETAIL_COMPONENT_OPTIONS).props ?? {};
    protected reactComponent = inject(REACT_CUSTOM_DETAIL_COMPONENT_OPTIONS).component;
    protected context: ReactCustomDetailComponentContext;

    ngOnInit() {
        this.context = {
            detailForm: this.detailForm,
            entity$: this.entity$,
        };
    }
}
