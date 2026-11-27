import { darkTheme, lightTheme } from '@vendure-io/design-tokens';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { BOOT_VARIABLES, resolveBootVariables, themeVariablesPlugin } from '../vite-plugin-theme.js';
import { transformIndexHtmlPlugin } from '../vite-plugin-transform-index.js';

const dashboardIndexHtml = path.join(import.meta.dirname, '../../index.html');
const tempDirs: string[] = [];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Builds the Dashboard's `index.html` with a stub app entry, the theme plugin and
 * the base path plugin, as the Dashboard build runs them, and returns the output HTML.
 */
async function buildIndexHtml(themeOptions: Parameters<typeof themeVariablesPlugin>[0]): Promise<string> {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vdb-theme-boot-style-'));
    tempDirs.push(root);
    fs.copyFileSync(dashboardIndexHtml, path.join(root, 'index.html'));
    fs.mkdirSync(path.join(root, 'src/app'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/app/main.tsx'), `console.log('app');\n`);
    await build({
        root,
        base: '/dashboard/',
        logLevel: 'silent',
        configFile: false,
        publicDir: false,
        build: { outDir: path.join(root, 'dist'), write: true },
        plugins: [themeVariablesPlugin(themeOptions), transformIndexHtmlPlugin()],
    });
    return fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
}

describe('theme boot style in index.html', () => {
    afterEach(() => {
        for (const dir of tempDirs.splice(0)) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('adds the boot colours of the light and dark theme first in the head', async () => {
        const html = await buildIndexHtml({});

        const declarations = (theme: Record<string, unknown>) =>
            resolveBootVariables(theme as Parameters<typeof resolveBootVariables>[0])
                .map(key => `--${key}: ${theme[key] as string};`)
                .join(' ');
        const bootStyle = `:root { ${declarations(lightTheme)} } .dark { ${declarations(darkTheme)} }`;
        // First, so the app stylesheet and user stylesheets after it win once they load
        expect(html).toMatch(
            new RegExp(`<head>\\s*<base href="/dashboard/">\\s*<style>${escapeRegExp(bootStyle)}</style>`),
        );
    });

    it('declares every variable that the boot screen styles of index.html read', () => {
        const indexStyle = fs
            .readFileSync(dashboardIndexHtml, 'utf8')
            .match(/<style>([\s\S]*?)<\/style>/)?.[1];
        const used = [...(indexStyle ?? '').matchAll(/var\(--([\w-]+)\)/g)].map(m => m[1]);

        expect(used.length).toBeGreaterThan(0);
        expect(BOOT_VARIABLES).toEqual(expect.arrayContaining(used));
    });

    // OSS-1508 — the boot shell reads tokens whose values read other tokens
    it('adds every variable that a boot variable reads, through the overrides', async () => {
        expect(resolveBootVariables({ card: 'var(--surface-raised)', 'surface-raised': 'white' })).toEqual([
            'card',
            'surface-raised',
        ]);

        const html = await buildIndexHtml({ theme: { light: { card: 'var(--primary)' } } });
        const root = html.match(/:root \{([^}]*)\}/)?.[1] ?? '';
        expect(root).toContain('--card: var(--primary);');
        expect(root).toContain(`--primary: ${lightTheme.primary};`);
    });

    it('uses the theme overrides of the Dashboard config', async () => {
        const html = await buildIndexHtml({
            theme: { light: { background: 'oklch(1 0 0)' }, dark: { background: 'oklch(0.1 0 0)' } },
        });

        expect(html).toContain(':root { --background: oklch(1 0 0);');
        expect(html).toContain('.dark { --background: oklch(0.1 0 0);');
    });

    it('keeps the theme script and the boot screen through the base path transform', async () => {
        const html = await buildIndexHtml({});

        expect(html).toContain(`<base href="/dashboard/">`);
        expect(html).toContain(`localStorage.getItem('vendure-user-settings')`);
        expect(html).toContain('<div id="boot-splash" role="status" aria-label="Loading">');
    });
});
