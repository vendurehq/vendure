import { useEffect, useState } from 'react';

import { globalRegistry } from '../registry/global-registry.js';

import { onExtensionSourceChange } from './define-dashboard-extension.js';
import { DashboardLoginExtensions } from './types/login.js';

export function useLoginExtensions(): DashboardLoginExtensions {
    const [extensions, setExtensions] = useState<DashboardLoginExtensions>(() => {
        return globalRegistry.get('loginExtensions') || {};
    });

    useEffect(() => {
        const updateExtensions = () => {
            setExtensions(globalRegistry.get('loginExtensions') || {});
        };

        // Subscribe to extension changes
        onExtensionSourceChange(updateExtensions);

        // Update immediately in case extensions were registered before this hook was called
        updateExtensions();
    }, []);

    return extensions;
}
