import { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import {
    DashboardWidgetConfig,
    DashboardWidgetService,
    DashboardWidgetWidth,
    DataService,
    LocalStorageService,
    titleSetter,
    WidgetLayout,
    WidgetLayoutDefinition,
} from '@vendure/admin-ui/core';
import { assertNever } from '@vendure/common/lib/shared-utils';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';

@Component({
    selector: 'vdr-dashboard',
    templateUrl: './dashboard.component.html',
    styleUrls: ['./dashboard.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DashboardComponent implements OnInit {
    widgetLayout: WidgetLayout | undefined;
    availableWidgets$: Observable<Array<{ id: string; config: DashboardWidgetConfig }>>;
    private readonly deletionMarker = '__delete__';
    private setTitle = titleSetter();
    constructor(
        private dashboardWidgetService: DashboardWidgetService,
        private localStorageService: LocalStorageService,
        private changedDetectorRef: ChangeDetectorRef,
        private dataService: DataService,
    ) {}

    ngOnInit() {
        this.availableWidgets$ = this.dataService.client.userStatus().stream$.pipe(
            map(({ userStatus }) => userStatus.permissions),
            map(permissions => this.dashboardWidgetService.getAvailableWidgets(permissions)),
            tap(widgets => (this.widgetLayout = this.initLayout(widgets.map(w => w.id)))),
        );
        this.setTitle('breadcrumb.dashboard');
    }

    getClassForWidth(width: DashboardWidgetWidth): string {
        switch (width) {
            case 3:
                return `clr-col-12 clr-col-sm-6 clr-col-lg-3`;
            case 4:
                return `clr-col-12 clr-col-sm-6 clr-col-lg-4`;
            case 6:
                return `clr-col-12 clr-col-lg-6`;
            case 8:
                return `clr-col-12 clr-col-lg-8`;
            case 12:
                return `clr-col-12`;
            default:
                assertNever(width);
        }
    }

    getSupportedWidths(config: DashboardWidgetConfig): DashboardWidgetWidth[] {
        return config.supportedWidths || [3, 4, 6, 8, 12];
    }

    setWidgetWidth(widget: WidgetLayout[number][number], width: DashboardWidgetWidth) {
        widget.width = width;
        this.recalculateLayout();
    }

    trackRow(index: number, row: WidgetLayout[number]) {
        const id = row.map(item => `${item.id}:${item.width}`).join('|');
        return id;
    }

    trackRowItem(index: number, item: WidgetLayout[number][number]) {
        return item.config;
    }

    addWidget(id: string) {
        const config = this.dashboardWidgetService.getWidgetById(id);
        if (config) {
            const width = this.getSupportedWidths(config)[0];
            const widget: WidgetLayout[number][number] = {
                id,
                config,
                width,
            };
            let targetRow: WidgetLayout[number];
            if (this.widgetLayout && this.widgetLayout.length) {
                targetRow = this.widgetLayout[this.widgetLayout.length - 1];
            } else {
                targetRow = [];
                this.widgetLayout?.push(targetRow);
            }
            targetRow.push(widget);
            this.recalculateLayout();
        }
    }

    removeWidget(widget: WidgetLayout[number][number]) {
        widget.id = this.deletionMarker;
        this.recalculateLayout();
    }

    drop(event: CdkDragDrop<{ index: number }>) {
        const { currentIndex, previousIndex, previousContainer, container } = event;
        if (previousIndex === currentIndex && previousContainer.data.index === container.data.index) {
            // Nothing changed
            return;
        }
        if (this.widgetLayout) {
            const previousLayoutRow = this.widgetLayout[previousContainer.data.index];
            const newLayoutRow = this.widgetLayout[container.data.index];

            previousLayoutRow.splice(previousIndex, 1);
            newLayoutRow.splice(currentIndex, 0, event.item.data);
            this.recalculateLayout();
        }
    }

    private initLayout(availableIds: string[]): WidgetLayout {
        const savedLayoutDef = this.localStorageService.get('dashboardWidgetLayout');
        let layoutDef: WidgetLayoutDefinition | undefined;
        if (savedLayoutDef) {
            // validate all the IDs from the saved layout are still available
            layoutDef = savedLayoutDef.filter(item => availableIds.includes(item.id));
        }
        return this.dashboardWidgetService.getWidgetLayout(layoutDef);
    }

    private recalculateLayout() {
        if (this.widgetLayout) {
            const flattened = this.widgetLayout
                .reduce((flat, row) => [...flat, ...row], [])
                .filter(item => item.id !== this.deletionMarker);
            const newLayoutDef: WidgetLayoutDefinition = flattened.map(item => ({
                id: item.id,
                width: item.width,
            }));
            this.widgetLayout = this.dashboardWidgetService.getWidgetLayout(newLayoutDef);
            this.localStorageService.set('dashboardWidgetLayout', newLayoutDef);
            setTimeout(() => this.changedDetectorRef.markForCheck());
        }
    }
}
