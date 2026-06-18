import {
    Component,
    ComponentRef,
    EventEmitter,
    inject,
    Input,
    OnInit,
    Output,
    ViewContainerRef,
} from '@angular/core';
import { SharedModule } from '../../shared/shared.module';
import { ROUTE_COMPONENT_OPTIONS, RouteComponent } from './route.component';

/**
 * @description
 * This component is used internally to allow us to dynamically load a component
 * like with `*ngComponentOutlet`, but with the ability to get a reference to the
 * created ComponentRef. This can then be used to delegate lifecycle events like
 * `canDeactivate` to the loaded component.
 */
@Component({
    selector: 'vdr-dynamic-component-loader',
    template: ``,
    imports: [SharedModule],
})
export class DynamicComponentLoaderComponent implements OnInit {
    @Input() componentType: any;
    @Output() loaded = new EventEmitter<ComponentRef<any>>();
    constructor(private viewContainer: ViewContainerRef) {}

    ngOnInit() {
        const componentRef = this.viewContainer.createComponent(this.componentType);
        this.loaded.emit(componentRef);
    }
}

@Component({
    selector: 'vdr-angular-route-component',
    template: `
        <vdr-route-component>
            <vdr-dynamic-component-loader [componentType]="component" (loaded)="componentLoaded($event)" />
        </vdr-route-component>
    `,
    imports: [SharedModule, RouteComponent, DynamicComponentLoaderComponent],
})
export class AngularRouteComponent {
    protected component = inject(ROUTE_COMPONENT_OPTIONS).component;
    protected componentRef: ComponentRef<any>;

    componentLoaded(componentRef: ComponentRef<any>) {
        this.componentRef = componentRef;
    }

    canDeactivate() {
        return this.componentRef?.instance?.canDeactivate?.();
    }
}
