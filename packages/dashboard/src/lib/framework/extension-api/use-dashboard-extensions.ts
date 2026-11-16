import { useEffect, useState } from 'react';
import { runDashboardExtensions } from 'virtual:dashboard-extensions';

import { onExtensionSourceChange } from './define-dashboard-extension.js';

// Shared by all callers of the hook, so that a component which mounts after the
// extensions have loaded gets `extensionsLoaded: true` on its first render.
let hasLoadedExtensions = false;

/**
 * @description
 * This hook is used to load dashboard extensions via the `virtual:dashboard-extensions` module,
 * which is provided by the `vite-plugin-dashboard-metadata` plugin.
 *
 * It should be used in any component whose rendering depends on the content of the dashboard extensions.
 */
export function useDashboardExtensions() {
    const [extensionsLoaded, setExtensionsLoaded] = useState(hasLoadedExtensions);
    const [reloadCount, setReloadCount] = useState(0);

    useEffect(() => {
        void runDashboardExtensions().then(() => {
            hasLoadedExtensions = true;
            setExtensionsLoaded(true);
        });
        onExtensionSourceChange(() => {
            // Setting this state var is only really done
            // in order to force a re-render of components using this hook.
            // This allows components to react to HMR events during development.
            setReloadCount(old => old + 1);
        });
    }, []);
    return { extensionsLoaded, reloadCount };
}
