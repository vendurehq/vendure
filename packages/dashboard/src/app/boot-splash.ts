// Not from constants.js: that imports the generated schema enums, which the unit tests cannot load.
import { LS_KEY_BOOT_SHELL } from '@/vdb/storage-keys.js';
import type { AuthContext } from '@/vdb/providers/auth.js';
import type { AnyRouter } from '@tanstack/react-router';

/**
 * Removes the boot screen of `index.html`. It covers the cold load from the
 * first paint, so the app's own splash and the pending page of the first route
 * stay hidden behind it, and the user sees one loading screen.
 */
export function removeBootSplash() {
    document.getElementById('boot-splash')?.remove();
    document.documentElement.removeAttribute('data-boot-shell');
    document.documentElement.removeAttribute('data-boot-filters');
}

/**
 * Removes the boot screen once the router has rendered the first page, and
 * returns the cleanup. The router emits `onResolved` from a layout effect, when
 * the page is in the DOM but not painted yet, so the page replaces the boot
 * screen in the same frame.
 */
export function removeBootSplashWhenResolved(router: Pick<AnyRouter, 'state' | 'subscribe'>): () => void {
    if (router.state.status === 'idle' && router.state.resolvedLocation) {
        removeBootSplash();
        return () => undefined;
    }
    const unsubscribe = router.subscribe('onResolved', () => {
        unsubscribe();
        removeBootSplash();
    });
    return unsubscribe;
}

/**
 * What the boot screen of `index.html` needs to draw the app shell: the base
 * path of the app, the text direction of the display language, and the number
 * of Insights filters that extensions register.
 */
export interface BootShellHint {
    base: string;
    dir: 'ltr' | 'rtl';
    filters: number;
}

/**
 * Keeps the boot shell hint under `LS_KEY_BOOT_SHELL` while an administrator is
 * signed in, and removes it on sign-out. The boot screen of `index.html` shows
 * the app shell only when the hint is set and the address is below its base
 * path, so a load that ends on the sign-in page keeps the spinner.
 */
export function rememberBootShell(
    status: AuthContext['status'],
    basepath: string,
    dir: BootShellHint['dir'],
    filters: number,
) {
    try {
        if (status === 'authenticated') {
            const hint: BootShellHint = { base: basepath.replace(/\/+$/, ''), dir, filters };
            localStorage.setItem(LS_KEY_BOOT_SHELL, JSON.stringify(hint));
        } else if (status === 'unauthenticated') {
            localStorage.removeItem(LS_KEY_BOOT_SHELL);
        }
    } catch (e) {
        // Storage can be full or blocked. The next load then shows the spinner.
        console.warn('Failed to store the boot shell hint', e);
    }
}
