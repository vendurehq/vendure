import {
    AfterContentInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ContentChild,
    ContentChildren,
    EventEmitter,
    inject,
    Injector,
    Input,
    OnChanges,
    OnDestroy,
    Output,
    QueryList,
    SimpleChanges,
    TemplateRef,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PaginationService } from 'ngx-pagination';
import { Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map, takeUntil } from 'rxjs/operators';
import { LanguageCode } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';
import { DataTableConfigService } from '../../../providers/data-table/data-table-config.service';
import { DataTableFilterCollection } from '../../../providers/data-table/data-table-filter-collection';
import { BulkActionMenuComponent } from '../bulk-action-menu/bulk-action-menu.component';

import { FilterPresetService } from '../data-table-filter-presets/filter-preset.service';
import { DataTable2ColumnComponent } from './data-table-column.component';
import {
    DataTableComponentConfig,
    DataTableCustomComponentService,
    DataTableLocationId,
} from './data-table-custom-component.service';
import { DataTableCustomFieldColumnComponent } from './data-table-custom-field-column.component';
import { DataTable2SearchComponent } from './data-table-search.component';

/**
 * @description
 * A table for displaying PaginatedList results. It is designed to be used inside components which
 * extend the {@link BaseListComponent} or {@link TypedBaseListComponent} class.
 *
 * @example
 * ```html
 * <vdr-data-table-2
 *     id="product-review-list"
 *     [items]="items$ | async"
 *     [itemsPerPage]="itemsPerPage$ | async"
 *     [totalItems]="totalItems$ | async"
 *     [currentPage]="currentPage$ | async"
 *     [filters]="filters"
 *     (pageChange)="setPageNumber($event)"
 *     (itemsPerPageChange)="setItemsPerPage($event)"
 * >
 *     <vdr-bulk-action-menu
 *         locationId="product-review-list"
 *         [hostComponent]="this"
 *         [selectionManager]="selectionManager"
 *     />
 *     <vdr-dt2-search
 *         [searchTermControl]="searchTermControl"
 *         searchTermPlaceholder="Filter by title"
 *     />
 *     <vdr-dt2-column [heading]="'common.id' | translate" [hiddenByDefault]="true">
 *         <ng-template let-review="item">
 *             {{ review.id }}
 *         </ng-template>
 *     </vdr-dt2-column>
 *     <vdr-dt2-column
 *         [heading]="'common.created-at' | translate"
 *         [hiddenByDefault]="true"
 *         [sort]="sorts.get('createdAt')"
 *     >
 *         <ng-template let-review="item">
 *             {{ review.createdAt | localeDate : 'short' }}
 *         </ng-template>
 *     </vdr-dt2-column>
 *     <vdr-dt2-column
 *         [heading]="'common.updated-at' | translate"
 *         [hiddenByDefault]="true"
 *         [sort]="sorts.get('updatedAt')"
 *     >
 *         <ng-template let-review="item">
 *             {{ review.updatedAt | localeDate : 'short' }}
 *         </ng-template>
 *     </vdr-dt2-column>
 *     <vdr-dt2-column [heading]="'common.name' | translate" [optional]="false" [sort]="sorts.get('name')">
 *         <ng-template let-review="item">
 *             <a class="button-ghost" [routerLink]="['./', review.id]"
 *                 ><span>{{ review.name }}</span>
 *                 <clr-icon shape="arrow right"></clr-icon>
 *             </a>
 *         </ng-template>
 *     </vdr-dt2-column>
 * </vdr-data-table-2>
 * ```
 *
 * @docsCategory components
 */
@Component({
    selector: 'vdr-data-table-2',
    templateUrl: 'data-table2.component.html',
    styleUrls: ['data-table2.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [PaginationService, FilterPresetService],
    standalone: false,
})
export class DataTable2Component<T> implements AfterContentInit, OnChanges, OnDestroy {
    @Input() id: DataTableLocationId;
    @Input() items: T[];
    @Input() itemsPerPage: number;
    @Input() currentPage: number;
    @Input() totalItems: number;
    @Input() emptyStateLabel: string;
    @Input() filters: DataTableFilterCollection;
    @Input() activeIndex = -1;
    @Input() trackByPath = 'id';
    @Output() pageChange = new EventEmitter<number>();
    @Output() itemsPerPageChange = new EventEmitter<number>();
    @Output() visibleColumnsChange = new EventEmitter<Array<DataTable2ColumnComponent<T>>>();

    @ContentChildren(DataTable2ColumnComponent) columns: QueryList<DataTable2ColumnComponent<T>>;
    @ContentChildren(DataTableCustomFieldColumnComponent)
    customFieldColumns: QueryList<DataTableCustomFieldColumnComponent<T>>;
    @ContentChild(DataTable2SearchComponent) searchComponent: DataTable2SearchComponent;
    @ContentChild(BulkActionMenuComponent) bulkActionMenuComponent: BulkActionMenuComponent;
    @ContentChild('vdrDt2CustomSearch') customSearchTemplate: TemplateRef<any>;
    @ContentChildren(TemplateRef) templateRefs: QueryList<TemplateRef<any>>;

    injector = inject(Injector);
    route = inject(ActivatedRoute);
    filterPresetService = inject(FilterPresetService);
    dataTableCustomComponentService = inject(DataTableCustomComponentService);
    dataTableConfigService = inject(DataTableConfigService);
    protected customComponents = new Map<string, { config: DataTableComponentConfig; injector: Injector }>();

    rowTemplate: TemplateRef<any>;
    currentStart: number;
    currentEnd: number;
    // This is used to apply a `user-select: none` CSS rule to the table,
    // which allows shift-click multi-row selection
    disableSelect = false;
    showSearchFilterRow = false;

    protected uiLanguage$: Observable<LanguageCode>;
    protected destroy$ = new Subject<void>();

    constructor(
        protected changeDetectorRef: ChangeDetectorRef,
        protected dataService: DataService,
    ) {
        this.uiLanguage$ = this.dataService.client
            .uiState()
            .stream$.pipe(map(({ uiState }) => uiState.language));
    }

    get selectionManager() {
        return this.bulkActionMenuComponent?.selectionManager;
    }

    get allColumns() {
        return [...(this.columns ?? []), ...(this.customFieldColumns ?? [])];
    }

    get visibleSortedColumns() {
        return this.sortedColumns.filter(c => c.visible);
    }

    get sortedColumns() {
        const columns = this.allColumns;
        const dataTableConfig = this.dataTableConfigService.getConfig(this.id);
        for (const [id, index] of Object.entries(dataTableConfig.order)) {
            const column = columns.find(c => c.id === id);
            const currentIndex = columns.findIndex(c => c.id === id);
            if (currentIndex !== -1 && column) {
                columns.splice(currentIndex, 1);
                columns.splice(index, 0, column);
            }
        }
        return columns;
    }

    private shiftDownHandler = (event: KeyboardEvent) => {
        if (event.shiftKey && !this.disableSelect) {
            this.disableSelect = true;
            this.changeDetectorRef.markForCheck();
        }
    };

    private shiftUpHandler = (event: KeyboardEvent) => {
        if (this.disableSelect) {
            this.disableSelect = false;
            this.changeDetectorRef.markForCheck();
        }
    };

    ngOnChanges(changes: SimpleChanges) {
        if (changes.items) {
            const startIndex = this.itemsPerPage * (this.currentPage - 1);
            this.currentStart = startIndex + 1;
            this.currentEnd = startIndex + changes.items.currentValue?.length;
            this.selectionManager?.setCurrentItems(this.items);
        }
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
        if (this.selectionManager) {
            document.removeEventListener('keydown', this.shiftDownHandler);
            document.removeEventListener('keyup', this.shiftUpHandler);
        }
    }

    ngAfterContentInit(): void {
        this.rowTemplate = this.templateRefs.last;
        const dataTableConfig = this.dataTableConfigService.getConfig(this.id);

        if (!this.id) {
            console.warn(`No id was assigned to the data table component`);
        }
        const updateColumnVisibility = () => {
            dataTableConfig.visibility = this.allColumns
                .filter(c => (c.visible && c.hiddenByDefault) || (!c.visible && !c.hiddenByDefault))
                .map(c => c.id);
            this.dataTableConfigService.setConfig(this.id, dataTableConfig);
            this.visibleColumnsChange.emit(this.visibleSortedColumns);
        };

        this.allColumns.forEach(column => {
            if (dataTableConfig?.visibility.includes(column.id)) {
                column.setVisibility(column.hiddenByDefault);
            }
            column.onColumnChange(updateColumnVisibility);
            const config = this.dataTableCustomComponentService.getCustomComponentsFor(this.id, column.id);
            if (config) {
                const injector = Injector.create({
                    parent: this.injector,
                    providers: config.providers ?? [],
                });
                this.customComponents.set(column.id, { config, injector });
            }
        });
        this.visibleColumnsChange.emit(this.visibleSortedColumns);

        if (this.selectionManager) {
            document.addEventListener('keydown', this.shiftDownHandler, { passive: true });
            document.addEventListener('keyup', this.shiftUpHandler, { passive: true });
            this.bulkActionMenuComponent.onClearSelection(() => {
                this.changeDetectorRef.markForCheck();
            });
            this.selectionManager.setCurrentItems(this.items);
        }
        this.showSearchFilterRow =
            !!this.filters?.activeFilters.length || (dataTableConfig?.showSearchFilterRow ?? false);
        this.columns.changes.subscribe(() => {
            this.changeDetectorRef.markForCheck();
        });

        this.selectionManager?.selectionChanges$
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => this.changeDetectorRef.markForCheck());

        if (this.selectionManager) {
            this.dataService.client
                .userStatus()
                .mapStream(({ userStatus }) => userStatus.activeChannelId)
                .pipe(distinctUntilChanged(), takeUntil(this.destroy$))
                .subscribe(() => {
                    this.selectionManager?.clearSelection();
                });
        }
    }

    onColumnReorder(event: { column: DataTable2ColumnComponent<any>; newIndex: number }) {
        const naturalIndex = this.allColumns.findIndex(c => c.id === event.column.id);
        const dataTableConfig = this.dataTableConfigService.getConfig(this.id);
        if (naturalIndex === event.newIndex) {
            delete dataTableConfig.order[event.column.id];
        } else {
            dataTableConfig.order[event.column.id] = event.newIndex;
        }
        this.dataTableConfigService.setConfig(this.id, dataTableConfig);
    }

    onColumnsReset() {
        const dataTableConfig = this.dataTableConfigService.getConfig(this.id);
        dataTableConfig.order = {};
        dataTableConfig.visibility = [];
        this.dataTableConfigService.setConfig(this.id, dataTableConfig);
    }

    toggleSearchFilterRow() {
        this.showSearchFilterRow = !this.showSearchFilterRow;
        const dataTableConfig = this.dataTableConfigService.getConfig(this.id);
        dataTableConfig.showSearchFilterRow = this.showSearchFilterRow;
        this.dataTableConfigService.setConfig(this.id, dataTableConfig);
    }

    trackByFn(index: number, item: any) {
        return (
            (this.trackByPath ?? 'id').split('.').reduce((accu, val) => {
                return accu && accu[val];
            }, item) ?? index
        );
    }

    onToggleAllClick() {
        this.selectionManager?.toggleSelectAll();
    }

    onRowClick(item: T, event: MouseEvent) {
        this.selectionManager?.toggleSelection(item, event);
    }
}
