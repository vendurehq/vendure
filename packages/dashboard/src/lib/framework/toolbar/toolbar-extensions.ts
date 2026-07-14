import { DashboardToolbarItemDefinition } from '@/vdb/framework/extension-api/types/toolbar.js';

import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('dashboardToolbarItemRegistry', new Map<string, DashboardToolbarItemDefinition>());

export function registerToolbarItem(item: DashboardToolbarItemDefinition) {
    globalRegistry.set('dashboardToolbarItemRegistry', map => {
        map.set(item.id, item);
        return map;
    });
}

export function getToolbarItemRegistry() {
    return globalRegistry.get('dashboardToolbarItemRegistry');
}
