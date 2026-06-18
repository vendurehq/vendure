import { Injectable } from '@angular/core';
import { DataTableConfig, LocalStorageService } from '../local-storage/local-storage.service';

@Injectable({
    providedIn: 'root',
})
export class DataTableConfigService {
    constructor(private localStorageService: LocalStorageService) {}

    getConfig(): DataTableConfig;
    getConfig(dataTableId: string): DataTableConfig[string];
    getConfig(dataTableId?: string): DataTableConfig[string] | DataTableConfig {
        const dataTableConfig = this.localStorageService.get('dataTableConfig') ?? {};
        if (dataTableId) {
            return (
                dataTableConfig[dataTableId] ?? {
                    visibility: [],
                    order: {},
                    showSearchFilterRow: false,
                    filterPresets: [],
                }
            );
        }
        return dataTableConfig;
    }

    setConfig(dataTableId: string, config: DataTableConfig[string]): void;
    setConfig(dataTableConfig: DataTableConfig): void;
    setConfig(idOrConfig: string | DataTableConfig, maybeConfig?: DataTableConfig[string]): void {
        const currentConfig = this.getConfig();
        if (typeof idOrConfig === 'string') {
            if (maybeConfig) {
                this.localStorageService.set('dataTableConfig', {
                    ...currentConfig,
                    [idOrConfig]: maybeConfig,
                });
            }
        } else {
            this.localStorageService.set('dataTableConfig', { ...currentConfig, ...idOrConfig });
        }
    }
}
