import { DashboardHistoryEntryComponent } from '@/vdb/framework/extension-api/types/index.js';

import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('historyEntries', new Map<string, DashboardHistoryEntryComponent['component']>());

export function getCustomHistoryEntryForType(
    type: string,
): DashboardHistoryEntryComponent['component'] | undefined {
    return globalRegistry.get('historyEntries').get(type);
}
