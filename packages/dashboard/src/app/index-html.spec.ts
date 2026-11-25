import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LS_KEY_BOOT_SHELL, LS_KEY_USER_SETTINGS } from '../lib/storage-keys.js';

const indexHtml = fs.readFileSync(path.join(import.meta.dirname, '../../index.html'), 'utf8');
const initial = new DOMParser().parseFromString(indexHtml, 'text/html');

// OSS-1487 — a dark-theme cold load paints dark from the first frame
describe('index.html', () => {
    const root = document.documentElement;

    function runThemeScript(stored: unknown, systemDark: boolean) {
        root.classList.remove('dark', 'light');
        if (stored === null) {
            localStorage.removeItem(LS_KEY_USER_SETTINGS);
        } else {
            localStorage.setItem(LS_KEY_USER_SETTINGS, JSON.stringify(stored));
        }
        vi.stubGlobal('matchMedia', (query: string) => ({
            matches: query === '(prefers-color-scheme: dark)' && systemDark,
        }));
        const script = initial.head.querySelector('script:not([src])');
        new Function(script?.textContent ?? '')();
        return root.classList.contains('dark') ? 'dark' : root.classList.contains('light') ? 'light' : '';
    }

    afterEach(() => {
        localStorage.removeItem(LS_KEY_USER_SETTINGS);
        root.classList.remove('dark', 'light');
        vi.unstubAllGlobals();
    });

    it('runs the theme script in the head, before the app', () => {
        const script = initial.head.querySelector('script:not([src])');
        expect(script?.getAttribute('type')).toBeNull();
        expect(script?.textContent).toContain(`localStorage.getItem('${LS_KEY_USER_SETTINGS}')`);
    });

    it('sets the saved theme, else the system theme', () => {
        expect(runThemeScript({ theme: 'dark' }, false)).toBe('dark');
        expect(runThemeScript({ theme: 'light' }, true)).toBe('light');
        expect(runThemeScript({ theme: 'system' }, true)).toBe('dark');
        expect(runThemeScript({ theme: 'system' }, false)).toBe('light');
        expect(runThemeScript(null, true)).toBe('dark');
        expect(runThemeScript(null, false)).toBe('light');
    });

    it('falls back to the system theme when the saved settings cannot be read', () => {
        root.classList.remove('dark', 'light');
        localStorage.setItem(LS_KEY_USER_SETTINGS, '{not json');
        vi.stubGlobal('matchMedia', () => ({ matches: true }));
        new Function(initial.head.querySelector('script:not([src])')?.textContent ?? '')();
        expect(root.classList.contains('dark')).toBe(true);
    });

    it('shows the boot screen outside the app root, so React does not replace it', () => {
        const splash = initial.getElementById('boot-splash');
        expect(splash?.parentElement).toBe(initial.body);
        expect(initial.getElementById('app')?.contains(splash)).toBe(false);
        expect(splash?.getAttribute('role')).toBe('status');
    });

    // OSS-1508 — a signed-in reload shows the app shell from the first paint
    describe('boot shell', () => {
        function bootShellFor(href: string, base: string | null, dir: 'ltr' | 'rtl' = 'ltr') {
            root.removeAttribute('data-boot-shell');
            root.removeAttribute('dir');
            if (base === null) {
                localStorage.removeItem(LS_KEY_BOOT_SHELL);
            } else {
                localStorage.setItem(LS_KEY_BOOT_SHELL, JSON.stringify({ base, dir }));
            }
            vi.stubGlobal('matchMedia', () => ({ matches: false }));
            window.history.replaceState(null, '', href);
            new Function(initial.head.querySelector('script:not([src])')?.textContent ?? '')();
            return root.getAttribute('data-boot-shell');
        }

        afterEach(() => {
            localStorage.removeItem(LS_KEY_BOOT_SHELL);
            root.removeAttribute('data-boot-shell');
            root.removeAttribute('dir');
            window.history.replaceState(null, '', '/');
        });

        it('reads the key that the app keeps', () => {
            expect(initial.head.querySelector('script:not([src])')?.textContent).toContain(
                `localStorage.getItem('${LS_KEY_BOOT_SHELL}')`,
            );
        });

        it('picks the page skeleton from the address below the base path', () => {
            expect(bootShellFor('/dashboard', '/dashboard')).toBe('home');
            expect(bootShellFor('/dashboard/', '/dashboard')).toBe('home');
            expect(bootShellFor('/dashboard/products', '/dashboard')).toBe('list');
            expect(bootShellFor('/dashboard/products?page=2#top', '/dashboard')).toBe('list');
            expect(bootShellFor('/dashboard/products/1', '/dashboard')).toBe('detail');
            expect(bootShellFor('/dashboard/global-settings', '/dashboard')).toBe('detail');
            expect(bootShellFor('/dashboard/profile', '/dashboard')).toBe('detail');
        });

        it('works with the app at the root', () => {
            expect(bootShellFor('/', '')).toBe('home');
            expect(bootShellFor('/products/1/variants', '')).toBe('detail');
            expect(bootShellFor('/login', '')).toBeNull();
        });

        it('keeps the spinner without the hint, outside the base path and on the sign-in pages', () => {
            expect(bootShellFor('/dashboard/products', null)).toBeNull();
            expect(bootShellFor('/admin/products', '/dashboard')).toBeNull();
            expect(bootShellFor('/dashboard-old/products', '/dashboard')).toBeNull();
            expect(bootShellFor('/dashboard/login', '/dashboard')).toBeNull();
            expect(bootShellFor('/dashboard/forgot-password', '/dashboard')).toBeNull();
            expect(bootShellFor('/dashboard/reset-password', '/dashboard')).toBeNull();
        });

        it('keeps the spinner when the hint cannot be read', () => {
            localStorage.setItem(LS_KEY_BOOT_SHELL, '{not json');
            vi.stubGlobal('matchMedia', () => ({ matches: false }));
            window.history.replaceState(null, '', '/dashboard/products');
            new Function(initial.head.querySelector('script:not([src])')?.textContent ?? '')();
            expect(root.getAttribute('data-boot-shell')).toBeNull();
        });

        it('sets the text direction of the last load, so a right-to-left shell does not mirror', () => {
            bootShellFor('/dashboard/products', '/dashboard', 'rtl');
            expect(root.getAttribute('dir')).toBe('rtl');
            bootShellFor('/dashboard/products', '/dashboard', 'ltr');
            expect(root.getAttribute('dir')).toBe('ltr');
        });

        it('knows every page outside the shell', () => {
            const script = initial.head.querySelector('script:not([src])')?.textContent ?? '';
            const signInPages = script.match(/SIGN_IN_PAGES = \[([^\]]*)\]/)?.[1] ?? '';
            const outsideShell = fs
                .readdirSync(path.join(import.meta.dirname, 'routes'))
                .filter(file => /^[a-z][\w-]*\.tsx$/.test(file))
                .map(file => file.replace(/\.tsx$/, ''));
            expect(outsideShell.length).toBeGreaterThan(0);
            for (const page of outsideShell) {
                expect(signInPages).toContain(`'${page}'`);
            }
        });

        it('hides the shell from assistive technology; the boot screen is the status', () => {
            const shell = initial.querySelector('#boot-splash .boot-shell');
            expect(shell?.getAttribute('aria-hidden')).toBe('true');
        });

        it('has no inline style attributes, so a strict style policy keeps the shell', () => {
            expect(initial.querySelectorAll('#boot-splash [style]')).toHaveLength(0);
        });
    });
});
