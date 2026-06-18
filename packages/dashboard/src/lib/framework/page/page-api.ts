import { DashboardRouteDefinition } from '../extension-api/types/navigation.js';

export const extensionRoutes = new Map<string, DashboardRouteDefinition>();

export function registerRoute(config: DashboardRouteDefinition) {
    if (config.path) {
        extensionRoutes.set(config.path, config);
    }
}
