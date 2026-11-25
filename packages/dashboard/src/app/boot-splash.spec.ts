import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeBootSplashWhenResolved } from './boot-splash.js';

type Router = Parameters<typeof removeBootSplashWhenResolved>[0];

function fakeRouter(state: { status: string; resolvedLocation?: unknown }) {
    const listeners = new Set<() => void>();
    const router = {
        state,
        subscribe: (_event: string, listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
    return {
        router: router as unknown as Router,
        listeners,
        resolve: () => [...listeners].forEach(listener => listener()),
    };
}

const splash = () => document.getElementById('boot-splash');

// OSS-1487 — the boot screen covers the cold load until the first page has rendered
describe('removeBootSplashWhenResolved', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="app"></div><div id="boot-splash"></div>';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('keeps the boot screen until the router has resolved the first page', () => {
        const { router, resolve } = fakeRouter({ status: 'pending' });

        removeBootSplashWhenResolved(router);
        expect(splash()).not.toBeNull();

        resolve();
        expect(splash()).toBeNull();
    });

    it('removes the boot screen at once when the router has already resolved', () => {
        const { router, listeners } = fakeRouter({ status: 'idle', resolvedLocation: { pathname: '/' } });

        removeBootSplashWhenResolved(router);

        expect(splash()).toBeNull();
        expect(listeners.size).toBe(0);
    });

    it('stops listening after the first page', () => {
        const { router, listeners, resolve } = fakeRouter({ status: 'pending' });

        removeBootSplashWhenResolved(router);
        resolve();

        expect(listeners.size).toBe(0);
    });

    it('stops listening on cleanup, so a remount subscribes once', () => {
        const { router, listeners } = fakeRouter({ status: 'pending' });

        removeBootSplashWhenResolved(router)();
        removeBootSplashWhenResolved(router);

        expect(listeners.size).toBe(1);
        expect(splash()).not.toBeNull();
    });
});
