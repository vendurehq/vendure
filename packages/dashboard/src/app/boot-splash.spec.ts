import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LS_KEY_BOOT_SHELL } from '../lib/storage-keys.js';
import { rememberBootShell, removeBootSplash, removeBootSplashWhenResolved } from './boot-splash.js';

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

// OSS-1508 — the boot screen shows the app shell only for a signed-in load
describe('rememberBootShell', () => {
    const hint = () => JSON.parse(localStorage.getItem(LS_KEY_BOOT_SHELL) ?? 'null');

    afterEach(() => {
        localStorage.removeItem(LS_KEY_BOOT_SHELL);
        vi.restoreAllMocks();
    });

    it('keeps the base path, without its trailing slash, and the direction while signed in', () => {
        rememberBootShell('authenticated', '/dashboard/', 'ltr');
        expect(hint()).toEqual({ base: '/dashboard', dir: 'ltr' });
        rememberBootShell('authenticated', '/', 'rtl');
        expect(hint()).toEqual({ base: '', dir: 'rtl' });
    });

    it('removes it on sign-out and keeps it while the session is checked', () => {
        rememberBootShell('authenticated', '/dashboard', 'ltr');
        rememberBootShell('initial', '/dashboard', 'ltr');
        rememberBootShell('verifying', '/dashboard', 'ltr');
        expect(hint()).toEqual({ base: '/dashboard', dir: 'ltr' });
        rememberBootShell('unauthenticated', '/dashboard', 'ltr');
        expect(hint()).toBeNull();
    });

    it('does not throw when the storage refuses the write', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(() => rememberBootShell('authenticated', '/dashboard', 'ltr')).not.toThrow();
    });
});

describe('removeBootSplash', () => {
    it('removes the boot screen and its shell attribute', () => {
        document.body.innerHTML = '<div id="boot-splash"></div>';
        document.documentElement.setAttribute('data-boot-shell', 'list');
        removeBootSplash();
        expect(document.getElementById('boot-splash')).toBeNull();
        expect(document.documentElement.hasAttribute('data-boot-shell')).toBe(false);
    });
});
