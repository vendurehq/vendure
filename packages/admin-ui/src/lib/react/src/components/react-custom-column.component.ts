import { Component, inject, InjectionToken, Input, OnInit, ViewEncapsulation } from '@angular/core';
import { CustomColumnComponent } from '@vendure/admin-ui/core';
import { ElementType } from 'react';
import { ReactComponentHostDirective } from '../directives/react-component-host.directive';

export const REACT_CUSTOM_COLUMN_COMPONENT_OPTIONS = new InjectionToken<{
    component: ElementType;
    props?: Record<string, any>;
}>('REACT_CUSTOM_COLUMN_COMPONENT_OPTIONS');

@Component({
    selector: 'vdr-react-custom-column-component',
    template: ` <div [vdrReactComponentHost]="reactComponent" [props]="props"></div> `,
    styleUrls: ['./react-global-styles.scss'],
    encapsulation: ViewEncapsulation.None,
    imports: [ReactComponentHostDirective]
})
export class ReactCustomColumnComponent implements CustomColumnComponent, OnInit {
    @Input() rowItem: any;

    protected reactComponent = inject(REACT_CUSTOM_COLUMN_COMPONENT_OPTIONS).component;
    private options = inject(REACT_CUSTOM_COLUMN_COMPONENT_OPTIONS);
    protected props: Record<string, any>;

    ngOnInit() {
        this.props = {
            rowItem: this.rowItem,
            ...(this.options.props ?? {}),
        };
    }
}
