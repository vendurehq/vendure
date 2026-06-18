import { CdkDragDrop } from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnDestroy,
    OnInit,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { distinctUntilChanged, map, startWith, takeUntil } from 'rxjs/operators';
import { DataTableFilterCollection } from '../../../providers/data-table/data-table-filter-collection';
import { ModalService } from '../../../providers/modal/modal.service';
import { FilterPresetService } from './filter-preset.service';
import { RenameFilterPresetDialogComponent } from './rename-filter-preset-dialog.component';

@Component({
    selector: 'vdr-data-table-filter-presets',
    templateUrl: './data-table-filter-presets.component.html',
    styleUrls: ['./data-table-filter-presets.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DataTableFilterPresetsComponent implements OnInit, OnDestroy {
    @Input({ required: true }) dataTableId: string;
    @Input({ required: true }) filters: DataTableFilterCollection;
    serializedActiveFilters: string;
    filterPresets$: Observable<Array<{ name: string; value: string }>>;

    private destroy$ = new Subject<void>();

    constructor(
        private route: ActivatedRoute,
        private filterPresetService: FilterPresetService,
        private modalService: ModalService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {}
    ngOnInit() {
        this.route.queryParamMap
            .pipe(
                map(qpm => qpm.get('filters')),
                distinctUntilChanged(),
                takeUntil(this.destroy$),
            )
            .subscribe(() => {
                this.serializedActiveFilters = this.filters.serialize();
                this.changeDetectorRef.markForCheck();
            });
        this.serializedActiveFilters = this.filters.serialize();

        this.filterPresets$ = this.filterPresetService.presetChanges$.pipe(
            startWith(this.filterPresetService.getFilterPresets(this.dataTableId)),
        );
        // When any query param changes, we want to trigger change detection
        // so that the links for each preset are updated.
        this.route.queryParamMap
            .pipe(takeUntil(this.destroy$))
            .subscribe(() => this.changeDetectorRef.markForCheck());
    }

    getQueryParamsForPreset(preset: string, serializedActiveFilters: string): Record<string, string> {
        // Clone the current query params to avoid mutating them directly
        const currentParams = { ...this.route.snapshot.queryParams };

        if (preset === serializedActiveFilters) {
            // Toggling off: remove 'filters' and 'page' params
            delete currentParams['filters'];
            delete currentParams['page'];
        } else {
            // Toggling on: set 'filters' and 'page' params
            currentParams['filters'] = preset;
            currentParams['page'] = 1;
        }

        return currentParams;
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    deleteFilterPreset(name: string) {
        this.filterPresetService.deleteFilterPreset({
            dataTableId: this.dataTableId,
            name,
        });
        this.serializedActiveFilters = this.filters.serialize();
    }

    renameFilterPreset(name: string) {
        this.modalService
            .fromComponent(RenameFilterPresetDialogComponent, {
                closable: true,
                locals: {
                    name,
                },
            })
            .subscribe(result => {
                if (result) {
                    this.filterPresetService.renameFilterPreset({
                        dataTableId: this.dataTableId,
                        oldName: name,
                        newName: result,
                    });
                }
            });
    }

    drop(event: CdkDragDrop<any>) {
        this.filterPresetService.reorderPresets(this.dataTableId, event.previousIndex, event.currentIndex);
    }
}
