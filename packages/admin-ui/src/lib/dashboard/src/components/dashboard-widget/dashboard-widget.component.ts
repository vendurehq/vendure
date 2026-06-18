import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ComponentRef,
    Input,
    OnDestroy,
    ViewChild,
    ViewContainerRef,
} from '@angular/core';
import { DashboardWidgetConfig } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-dashboard-widget',
    templateUrl: './dashboard-widget.component.html',
    styleUrls: ['./dashboard-widget.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DashboardWidgetComponent implements AfterViewInit, OnDestroy {
    @Input() widgetConfig: DashboardWidgetConfig;

    @ViewChild('portal', { read: ViewContainerRef })
    private portal: ViewContainerRef;

    private componentRef: ComponentRef<any>;

    ngAfterViewInit(): void {
        this.loadWidget();
    }

    private async loadWidget() {
        const loadComponentResult = this.widgetConfig.loadComponent();
        const componentType =
            loadComponentResult instanceof Promise ? await loadComponentResult : loadComponentResult;
        this.componentRef = this.portal.createComponent(componentType);
        this.componentRef.changeDetectorRef.detectChanges();
    }

    ngOnDestroy() {
        if (this.componentRef) {
            this.componentRef.destroy();
        }
    }
}
