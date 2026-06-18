import { DashboardHistoryEntryComponent } from '@/vdb/framework/extension-api/types/index.js';

import { globalRegistry } from '../../registry/global-registry.js';

export function registerHistoryEntryComponents(
    historyEntryComponents: DashboardHistoryEntryComponent[] = [],
) {
    if (historyEntryComponents.length === 0) {
        return;
    }
    globalRegistry.set('historyEntries', entryMap => {
        for (const entry of historyEntryComponents) {
            const existingEntry = entryMap.get(entry.type);
            if (existingEntry) {
                // eslint-disable-next-line no-console
                console.warn(
                    `The history entry type ${entry.type} already has a custom component registered (${String(existingEntry)}`,
                );
            }
            entryMap.set(entry.type, entry.component);
        }
        return entryMap;
    });
}
