import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Input,
    OnDestroy,
    OnInit,
    ViewChild,
} from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { merge, Subject } from 'rxjs';
import { distinctUntilChanged, map, takeUntil } from 'rxjs/operators';
import { DataTableFilterCollection } from '../../../providers/data-table/data-table-filter-collection';
import { DropdownComponent } from '../dropdown/dropdown.component';
import { FilterPresetService } from './filter-preset.service';

@Component({
    selector: 'vdr-add-filter-preset-button',
    templateUrl: './add-filter-preset-button.component.html',
    styleUrls: ['./add-filter-preset-button.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AddFilterPresetButtonComponent implements OnInit, OnDestroy {
    @Input({ required: true }) dataTableId: string;
    @Input({ required: true }) filters: DataTableFilterCollection;
    @ViewChild('addPresetDropdown') addPresetDropdown: DropdownComponent;
    selectedFilterPreset: string | undefined;
    filterPresetName = new FormControl('');
    private destroy$ = new Subject<void>();

    constructor(
        private filterPresetService: FilterPresetService,
        private changeDetector: ChangeDetectorRef,
        private route: ActivatedRoute,
    ) {}

    ngOnInit() {
        merge(
            this.route.queryParamMap.pipe(
                map(qpm => qpm.get('filters')),
                distinctUntilChanged(),
                takeUntil(this.destroy$),
            ),
            this.filterPresetService.presetChanges$,
            this.filters.valueChanges,
        ).subscribe(() => {
            this.changeDetector.markForCheck();
            this.updateSelectedFilterPreset();
        });
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    saveFilterPreset() {
        const name = this.filterPresetName.value;
        if (this.filters && name) {
            const value = this.filters.serialize();
            this.filterPresetService.saveFilterPreset({
                dataTableId: this.dataTableId,
                name,
                value,
            });
            this.filterPresetName.setValue('');
            this.addPresetDropdown.toggleOpen();
        }
        this.updateSelectedFilterPreset();
    }

    private updateSelectedFilterPreset() {
        this.selectedFilterPreset = this.filterPresetService
            .getFilterPresets(this.dataTableId)
            .find(p => p.value === this.filters.serialize())?.name;
    }
}
