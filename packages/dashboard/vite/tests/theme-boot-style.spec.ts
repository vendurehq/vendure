import { darkTheme, lightTheme } from '@vendure-io/design-tokens';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { themeVariablesPlugin } from '../vite-plugin-theme.js';
import { transformIndexHtmlPlugin } from '../vite-plugin-transform-index.js';

const dashboardIndexHtml = path.join(import.meta.dirname, '../../index.html');
const tempDirs: string[] = [];

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

    it('adds the boot colours of the light and dark theme before the boot screen styles', async () => {
        const html = await buildIndexHtml({});

        const bootStyle = `:root { --background: ${lightTheme.background}; --muted-foreground: ${lightTheme['muted-foreground']}; } .dark { --background: ${darkTheme.background}; --muted-foreground: ${darkTheme['muted-foreground']}; }`;
        expect(html).toContain(`<style>${bootStyle}</style>`);
        expect(html.indexOf(bootStyle)).toBeLessThan(html.search(/#boot-splash\s*\{/));
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
