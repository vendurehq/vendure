import { Component, inject, InjectionToken, ViewEncapsulation } from '@angular/core';
import { ROUTE_COMPONENT_OPTIONS, RouteComponent, SharedModule } from '@vendure/admin-ui/core';
import { ReactComponentHostDirective } from '../directives/react-component-host.directive';
import { ReactRouteComponentOptions } from '../types';

export const REACT_ROUTE_COMPONENT_OPTIONS = new InjectionToken<ReactRouteComponentOptions>(
    'REACT_ROUTE_COMPONENT_OPTIONS',
);

@Component({
    selector: 'vdr-react-route-component',
    template: `
        <vdr-route-component
            ><div [vdrReactComponentHost]="reactComponent" [props]="props"></div
        ></vdr-route-component>
    `,
    styleUrls: ['./react-global-styles.scss'],
    encapsulation: ViewEncapsulation.None,
    imports: [ReactComponentHostDirective, RouteComponent, SharedModule]
})
export class ReactRouteComponent {
    protected props = inject(REACT_ROUTE_COMPONENT_OPTIONS).props;
    protected reactComponent = inject(ROUTE_COMPONENT_OPTIONS).component;
}
