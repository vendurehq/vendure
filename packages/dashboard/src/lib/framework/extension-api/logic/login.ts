import { globalRegistry } from '../../registry/global-registry.js';
import { DashboardLoginExtensions } from '../types/login.js';

export function registerLoginExtensions(loginExtensions?: DashboardLoginExtensions) {
    if (!loginExtensions) {
        return;
    }

    const registryKey = 'loginExtensions';

    globalRegistry.set(registryKey, (oldValue: DashboardLoginExtensions) => {
        return {
            ...oldValue,
            ...loginExtensions,
        };
    });
}
