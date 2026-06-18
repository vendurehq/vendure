import { moveItemInArray } from '@angular/cdk/drag-drop';
import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { DataTableConfigService } from '../../../providers/data-table/data-table-config.service';

@Injectable({
    providedIn: 'root',
})
export class FilterPresetService {
    presetChanges$: Observable<Array<{ name: string; value: string }>>;
    private _presetChanges = new Subject<Array<{ name: string; value: string }>>();

    constructor(private dataTableConfigService: DataTableConfigService) {
        this.presetChanges$ = this._presetChanges.asObservable();
    }

    getFilterPresets(dataTableId: string): Array<{ name: string; value: string }> {
        const dataTableConfig = this.dataTableConfigService.getConfig(dataTableId);
        return dataTableConfig.filterPresets ?? [];
    }

    saveFilterPreset(config: { dataTableId: string; name: string; value: string }) {
        const dataTableConfig = this.dataTableConfigService.getConfig(config.dataTableId);
        const filterPresets = dataTableConfig.filterPresets ?? [];
        const existingName = filterPresets.find(p => p.name === config.name);
        if (existingName) {
            existingName.value = config.value;
        } else {
            filterPresets.push({
                name: config.name,
                value: config.value,
            });
        }
        dataTableConfig.filterPresets = filterPresets;
        this.dataTableConfigService.setConfig(config.dataTableId, dataTableConfig);
        this._presetChanges.next(filterPresets);
    }

    deleteFilterPreset(config: { dataTableId: string; name: string }) {
        const dataTableConfig = this.dataTableConfigService.getConfig(config.dataTableId);
        dataTableConfig.filterPresets = dataTableConfig.filterPresets.filter(p => p.name !== config.name);
        this.dataTableConfigService.setConfig(config.dataTableId, dataTableConfig);
        this._presetChanges.next(dataTableConfig.filterPresets);
    }

    reorderPresets(dataTableId: string, fromIndex: number, toIndex: number) {
        const presets = this.getFilterPresets(dataTableId);
        moveItemInArray(presets, fromIndex, toIndex);
        const dataTableConfig = this.dataTableConfigService.getConfig(dataTableId);
        dataTableConfig.filterPresets = presets;
        this.dataTableConfigService.setConfig(dataTableId, dataTableConfig);
        this._presetChanges.next(presets);
    }

    renameFilterPreset(config: { dataTableId: string; oldName: string; newName: string }) {
        const dataTableConfig = this.dataTableConfigService.getConfig(config.dataTableId);
        const filterPresets = dataTableConfig.filterPresets ?? [];
        const existingName = filterPresets.find(p => p.name === config.oldName);
        if (existingName) {
            existingName.name = config.newName;
            dataTableConfig.filterPresets = filterPresets;
            this.dataTableConfigService.setConfig(config.dataTableId, dataTableConfig);
            this._presetChanges.next(filterPresets);
        }
    }
}
