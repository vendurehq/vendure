import { Injectable, Type } from '@angular/core';

import { HistoryEntryComponent, HistoryEntryConfig } from './history-entry-component-types';

@Injectable({
    providedIn: 'root',
})
export class HistoryEntryComponentService {
    private customEntryComponents = new Map<string, HistoryEntryConfig>();

    registerComponent(config: HistoryEntryConfig) {
        this.customEntryComponents.set(config.type, config);
    }

    getComponent(type: string): Type<HistoryEntryComponent> | undefined {
        return this.customEntryComponents.get(type)?.component;
    }
}
