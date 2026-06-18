import {
    ChangeDetectionStrategy,
    Component,
    ComponentFactoryResolver,
    ComponentRef,
    Injector,
    Input,
    OnDestroy,
    OnInit,
    ViewContainerRef,
} from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { Observable } from 'rxjs';

import { CustomDetailComponentLocationId } from '../../../common/component-registry-types';
import { CustomDetailComponent } from '../../../providers/custom-detail-component/custom-detail-component-types';
import { CustomDetailComponentService } from '../../../providers/custom-detail-component/custom-detail-component.service';

@Component({
    selector: 'vdr-custom-detail-component-host',
    templateUrl: './custom-detail-component-host.component.html',
    styleUrls: ['./custom-detail-component-host.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CustomDetailComponentHostComponent implements OnInit, OnDestroy {
    @Input() locationId: CustomDetailComponentLocationId;
    @Input() entity$: Observable<any>;
    @Input() detailForm: UntypedFormGroup;

    private componentRefs: Array<ComponentRef<CustomDetailComponent>> = [];

    constructor(
        private viewContainerRef: ViewContainerRef,
        private customDetailComponentService: CustomDetailComponentService,
        private injector: Injector,
    ) {}

    ngOnInit(): void {
        const customComponents = this.customDetailComponentService.getCustomDetailComponentsFor(
            this.locationId,
        );

        for (const config of customComponents) {
            const componentRef = this.viewContainerRef.createComponent(config.component, {
                injector: Injector.create({
                    parent: this.injector,
                    providers: config.providers ?? [],
                }),
            });
            componentRef.instance.entity$ = this.entity$;
            componentRef.instance.detailForm = this.detailForm;
            this.componentRefs.push(componentRef);
        }
    }

    ngOnDestroy() {
        for (const ref of this.componentRefs) {
            ref.destroy();
        }
    }
}
