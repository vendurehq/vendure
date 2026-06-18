import { DashboardActionBarItem, DashboardPageBlockDefinition } from '../extension-api/types/layout.js';
import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register('dashboardActionBarItemRegistry', new Map<string, DashboardActionBarItem[]>());
globalRegistry.register('dashboardPageBlockRegistry', new Map<string, DashboardPageBlockDefinition[]>());

export function registerDashboardActionBarItem(item: DashboardActionBarItem) {
    globalRegistry.set('dashboardActionBarItemRegistry', map => {
        map.set(item.pageId, [...(map.get(item.pageId) ?? []), item]);
        return map;
    });
}

export function getDashboardActionBarItems(pageId: string) {
    return globalRegistry.get('dashboardActionBarItemRegistry').get(pageId) ?? [];
}

export function registerDashboardPageBlock(block: DashboardPageBlockDefinition) {
    globalRegistry.set('dashboardPageBlockRegistry', map => {
        map.set(block.location.pageId, [...(map.get(block.location.pageId) ?? []), block]);
        return map;
    });
}

export function getDashboardPageBlocks(pageId: string) {
    return globalRegistry.get('dashboardPageBlockRegistry').get(pageId) ?? [];
}
