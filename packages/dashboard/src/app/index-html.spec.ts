import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LS_KEY_USER_SETTINGS } from '../lib/storage-keys.js';

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
});
