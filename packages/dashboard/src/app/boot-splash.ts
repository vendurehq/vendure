import type { AnyRouter } from '@tanstack/react-router';

/**
 * Removes the boot screen of `index.html`. It covers the cold load from the
 * first paint, so the app's own splash and the pending page of the first route
 * stay hidden behind it, and the user sees one loading screen.
 */
export function removeBootSplash() {
    document.getElementById('boot-splash')?.remove();
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
