import { useEffect, useState } from 'react';
import { runDashboardExtensions } from 'virtual:dashboard-extensions';

import { executeDashboardExtensionCallbacks, onExtensionSourceChange } from './define-dashboard-extension.js';

// Extension registration writes into the global registry and must run exactly once
// per page load. This module-level flag guards against duplicate execution caused by
// React Strict Mode's mount/unmount/remount cycle (and any additional hook consumers).
let extensionCallbacksExecuted = false;

/**
 * @description
 * This hook is used to load dashboard extensions via the `virtual:dashboard-extensions` module,
 * which is provided by the `vite-plugin-dashboard-metadata` plugin.
 *
 * It should be used in any component whose rendering depends on the content of the dashboard extensions.
 */
export function useDashboardExtensions() {
    const [extensionsLoaded, setExtensionsLoaded] = useState(false);
    const [reloadCount, setReloadCount] = useState(0);

    useEffect(() => {
        void runDashboardExtensions()
            .catch(err => {
                // eslint-disable-next-line no-console
                console.error('Failed to load dashboard extensions', err);
            })
            .finally(() => {
                try {
                    if (!extensionCallbacksExecuted) {
                        // Set before invoking so a concurrent second resolution
                        // (Strict Mode) can't re-enter and register twice.
                        extensionCallbacksExecuted = true;
                        executeDashboardExtensionCallbacks();
                    }
                } catch (err) {
                    // eslint-disable-next-line no-console
                    console.error('Error executing dashboard extension callbacks', err);
                } finally {
                    // Always leave the loading screen, even if registration threw,
                    // so the app never hangs on the boot splash.
                    setExtensionsLoaded(true);
                }
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
