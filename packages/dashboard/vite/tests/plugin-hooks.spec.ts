import { pathToFileURL } from 'node:url';
import path from 'path';
import type { Plugin } from 'vite';
import { describe, expect, it, vi } from 'vitest';

import { PluginInfo } from '../types.js';
import { bundleEntryPlugin } from '../vite-plugin-bundle-entry.js';
import { viteConfigPlugin } from '../vite-plugin-config.js';
import { dashboardMetadataPlugin } from '../vite-plugin-dashboard-metadata.js';
import { hmrPlugin } from '../vite-plugin-hmr.js';
import { dashboardTailwindSourcePlugin } from '../vite-plugin-tailwind-source.js';
import { themeVariablesPlugin } from '../vite-plugin-theme.js';
import { transformIndexHtmlPlugin } from '../vite-plugin-transform-index.js';

// ─── Typed hook helpers ─────────────────────────────────────────────────────
// Thin wrappers that cast once so individual tests stay type-safe without
// @ts-expect-error on every call.

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

function callTransform(plugin: Plugin, code: string, id: string) {
    return (plugin.transform as (code: string, id: string) => any)(code, id);
}

function callTransformWithContext(plugin: Plugin, ctx: unknown, code: string, id: string) {
    return (plugin.transform as (code: string, id: string) => any).call(ctx, code, id);
}

function callConfig(plugin: Plugin, config: Record<string, any>, env: { command: string }) {
    return (plugin.config as (config: Record<string, any>, env: { command: string }) => any)(config, env);
}

function callConfigResolved(plugin: Plugin, config: Record<string, any>) {
    return (plugin.configResolved as (config: Record<string, any>) => void)(config);
}

function callResolveId(plugin: Plugin, id: string) {
    return (plugin.resolveId as (id: string) => any)(id);
}

function callLoad(plugin: Plugin, ctx: unknown, id: string) {
    return (plugin.load as (id: string) => any).call(ctx, id);
}

function callTransformIndexHtml(plugin: Plugin, html: string, ctx: { filename: string }) {
    return (plugin.transformIndexHtml as (html: string, ctx: { filename: string }) => any)(html, ctx);
}

function callHandleHotUpdate(plugin: Plugin, ctx: Record<string, any>) {
    return (plugin.handleHotUpdate as (ctx: Record<string, any>) => any)(ctx);
}

// ─── Shared test factories ──────────────────────────────────────────────────

function createFakeConfigLoaderPlugin(pluginInfo: PluginInfo[]) {
    return {
        name: 'vendure:config-loader',
        api: {
            getVendureConfig: () =>
                Promise.resolve({
                    pluginInfo,
                    vendureConfig: {},
                    exportedSymbolName: 'config',
                }),
        },
    };
}

function setupConfigLoaderPlugin(plugin: Plugin, pluginInfo: PluginInfo[]) {
    callConfigResolved(plugin, { plugins: [createFakeConfigLoaderPlugin(pluginInfo)] });
    return plugin;
}

// ─── themeVariablesPlugin ────────────────────────────────────────────────────

describe('themeVariablesPlugin', () => {
    it('returns null for non-styles.css files', () => {
        const plugin = themeVariablesPlugin({});
        const result = callTransform(plugin, 'body { color: red; }', '/app/main.css');
        expect(result).toBeNull();
    });

    it('returns null when CSS has no @import virtual:admin-theme', () => {
        const plugin = themeVariablesPlugin({});
        const result = callTransform(plugin, 'body { color: red; }', '/app/styles.css');
        expect(result).toBeNull();
    });

    it('replaces single-quoted @import with theme variables', () => {
        const plugin = themeVariablesPlugin({});
        const css = `@import 'virtual:admin-theme';\nbody { color: red; }`;
        const result = callTransform(plugin, css, '/app/styles.css');
        expect(result).toContain(':root');
        expect(result).toContain('.dark');
        expect(result).toContain('--background:');
        expect(result).toContain('body { color: red; }');
    });

    it('replaces double-quoted @import with theme variables', () => {
        const plugin = themeVariablesPlugin({});
        const css = `@import "virtual:admin-theme";\nbody { color: red; }`;
        const result = callTransform(plugin, css, '/app/styles.css');
        expect(result).toContain(':root');
        expect(result).toContain('.dark');
    });

    it('merges custom light theme colors with defaults', () => {
        const plugin = themeVariablesPlugin({
            theme: { light: { background: 'red' } },
        });
        const css = `@import 'virtual:admin-theme';`;
        const result = callTransform(plugin, css, '/app/styles.css');
        expect(result).toContain('--background: red;');
        // Other defaults should still be present
        expect(result).toContain('--foreground:');
    });

    it('merges custom dark theme colors with defaults', () => {
        const plugin = themeVariablesPlugin({
            theme: { dark: { background: 'navy' } },
        });
        const css = `@import 'virtual:admin-theme';`;
        const result = callTransform(plugin, css, '/app/styles.css');
        expect(result).toContain('.dark');
        expect(result).toContain('--background: navy;');
    });

    it('preserves surrounding CSS', () => {
        const plugin = themeVariablesPlugin({});
        const css = `.header { display: flex; }\n@import 'virtual:admin-theme';\n.footer { margin: 0; }`;
        const result = callTransform(plugin, css, '/app/styles.css');
        expect(result).toContain('.header { display: flex; }');
        expect(result).toContain('.footer { margin: 0; }');
    });

    it('replaces virtual:admin-theme-inline with @theme inline block', () => {
        const plugin = themeVariablesPlugin({});
        const css = `@import 'virtual:admin-theme-inline';`;
        const result = callTransform(plugin, css, '/app/styles.css');
        expect(result).toContain('@theme inline');
        expect(result).toContain('--color-background: var(--background);');
        expect(result).toContain('--radius-sm:');
        expect(result).toContain('--shadow-sm:');
        expect(result).toContain('--font-sans: var(--font-sans);');
        expect(result).toContain('--color-dev-mode: var(--dev-mode);');
        expect(result).toContain('--color-vendure-brand: #17c1ff;');
    });

    it('generates radius values directly from design tokens (not calc-based)', () => {
        const plugin = themeVariablesPlugin({});
        const css = `@import 'virtual:admin-theme-inline';`;
        const result = callTransform(plugin, css, '/app/styles.css');
        // All radius values should be direct token values, not calc() expressions
        expect(result).not.toContain('calc(');
        expect(result).toContain('--radius-sm: 0.2rem;');
        expect(result).toContain('--radius-md: 0.2rem;');
        expect(result).toContain('--radius-lg: 0.2rem;');
        expect(result).toContain('--radius-xl: 0.2rem;');
    });

    it('handles both virtual imports in the same file', () => {
        const plugin = themeVariablesPlugin({});
        const css = `@import 'virtual:admin-theme';\n@import 'virtual:admin-theme-inline';`;
        const result = callTransform(plugin, css, '/app/styles.css');
        expect(result).toContain(':root');
        expect(result).toContain('.dark');
        expect(result).toContain('@theme inline');
    });

    it('replaces double-quoted virtual:admin-theme-inline', () => {
        const plugin = themeVariablesPlugin({});
        const css = `@import "virtual:admin-theme-inline";`;
        const result = callTransform(plugin, css, '/app/styles.css');
        expect(result).toContain('@theme inline');
    });
});

// ─── transformIndexHtmlPlugin ────────────────────────────────────────────────

describe('transformIndexHtmlPlugin', () => {
    const sampleHtml = [
        '<html>',
        '<head>',
        '  <link rel="stylesheet" href="/dashboard/assets/style.css">',
        '  <script src="/dashboard/assets/main.js"></script>',
        '</head>',
        '<body></body>',
        '</html>',
    ].join('\n');

    it('has apply: build so it only runs during builds', () => {
        const plugin = transformIndexHtmlPlugin();
        expect(plugin.apply).toBe('build');
    });

    it('returns HTML unchanged when base is "/"', () => {
        const plugin = transformIndexHtmlPlugin();
        callConfigResolved(plugin, { base: '/' });
        const result = callTransformIndexHtml(plugin, sampleHtml, { filename: 'index.html' });
        expect(result).toBe(sampleHtml);
    });

    it('strips base path from href attributes', () => {
        const plugin = transformIndexHtmlPlugin();
        callConfigResolved(plugin, { base: '/dashboard/' });
        const result = callTransformIndexHtml(plugin, sampleHtml, { filename: 'index.html' });
        expect(result).toContain('href="assets/style.css"');
    });

    it('strips base path from src attributes', () => {
        const plugin = transformIndexHtmlPlugin();
        callConfigResolved(plugin, { base: '/dashboard/' });
        const result = callTransformIndexHtml(plugin, sampleHtml, { filename: 'index.html' });
        expect(result).toContain('src="assets/main.js"');
    });

    it('adds <base> tag after <head>', () => {
        const plugin = transformIndexHtmlPlugin();
        callConfigResolved(plugin, { base: '/dashboard/' });
        const result = callTransformIndexHtml(plugin, sampleHtml, { filename: 'index.html' });
        expect(result).toContain('<base href="/dashboard/">');
    });

    it('does not transform Storybook HTML (iframe.html)', () => {
        const plugin = transformIndexHtmlPlugin();
        callConfigResolved(plugin, { base: '/dashboard/' });
        const result = callTransformIndexHtml(plugin, sampleHtml, {
            filename: '/path/to/iframe.html',
        });
        expect(result).toBe(sampleHtml);
    });

    it('does not transform Storybook HTML (storybook path)', () => {
        const plugin = transformIndexHtmlPlugin();
        callConfigResolved(plugin, { base: '/dashboard/' });
        const result = callTransformIndexHtml(plugin, sampleHtml, {
            filename: '/storybook/index.html',
        });
        expect(result).toBe(sampleHtml);
    });

    it('handles multiple href/src attributes in one file', () => {
        const html = [
            '<html><head>',
            '<link href="/app/a.css">',
            '<link href="/app/b.css">',
            '<script src="/app/x.js"></script>',
            '<script src="/app/y.js"></script>',
            '</head><body></body></html>',
        ].join('\n');
        const plugin = transformIndexHtmlPlugin();
        callConfigResolved(plugin, { base: '/app/' });
        const result = callTransformIndexHtml(plugin, html, { filename: 'index.html' });
        expect(result).toContain('href="a.css"');
        expect(result).toContain('href="b.css"');
        expect(result).toContain('src="x.js"');
        expect(result).toContain('src="y.js"');
    });
});

// ─── viteConfigPlugin ────────────────────────────────────────────────────────

describe('viteConfigPlugin', () => {
    const packageRoot = '/fake/dashboard';

    it('sets root to packageRoot', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, {}, { command: 'serve' });
        expect(result.root).toBe(packageRoot);
    });

    it('sets default publicDir when not provided', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, {}, { command: 'serve' });
        expect(result.publicDir).toBe(path.join(packageRoot, 'public'));
    });

    it('preserves existing publicDir', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, { publicDir: '/custom/public' }, { command: 'serve' });
        expect(result.publicDir).toBe('/custom/public');
    });

    it('sets resolve aliases for @/vdb and @/graphql', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, {}, { command: 'serve' });
        const aliases = result.resolve.alias as Record<string, string>;
        expect(aliases['@/vdb']).toBe(path.resolve(packageRoot, './src/lib'));
        expect(aliases['@/graphql']).toBe(path.resolve(packageRoot, './src/lib/graphql'));
    });

    it('preserves existing resolve aliases', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const config = { resolve: { alias: { '@custom': '/custom/path' } } };
        const result = callConfig(plugin, config, { command: 'serve' });
        const aliases = result.resolve.alias as Record<string, string>;
        expect(aliases['@custom']).toBe('/custom/path');
        expect(aliases['@/vdb']).toBeDefined();
    });

    it('sets optimizeDeps.exclude with virtual modules', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, {}, { command: 'serve' });
        expect(result.optimizeDeps.exclude).toContain('@vendure/dashboard');
        expect(result.optimizeDeps.exclude).toContain('virtual:vendure-ui-config');
        expect(result.optimizeDeps.exclude).toContain('virtual:dashboard-extensions');
    });

    it('sets optimizeDeps.include with recharts etc', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, {}, { command: 'serve' });
        expect(result.optimizeDeps.include).toContain('@/components > recharts');
        expect(result.optimizeDeps.include).toContain('@vendure/common/lib/generated-types');
    });

    it('build command: resolves relative outDir to absolute path from cwd', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, { build: { outDir: 'my-output' } }, { command: 'build' });
        expect(path.isAbsolute(result.build.outDir)).toBe(true);
        expect(result.build.outDir).toBe(path.resolve(process.cwd(), 'my-output'));
    });

    it('build command: preserves absolute outDir', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, { build: { outDir: '/abs/output' } }, { command: 'build' });
        expect(result.build.outDir).toBe('/abs/output');
    });

    it('build command: defaults outDir to cwd/dist', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, {}, { command: 'build' });
        expect(result.build.outDir).toBe(path.resolve(process.cwd(), 'dist'));
    });

    it('serve command: does not set build.outDir', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, {}, { command: 'serve' });
        expect(result.build).toBeUndefined();
    });
});

// ─── dashboardMetadataPlugin ─────────────────────────────────────────────────

describe('dashboardMetadataPlugin', () => {
    function setupPlugin(pluginInfo: PluginInfo[]) {
        return setupConfigLoaderPlugin(dashboardMetadataPlugin(), pluginInfo);
    }

    it('resolveId returns resolved ID for virtual:dashboard-extensions', () => {
        const plugin = setupPlugin([]);
        const result = callResolveId(plugin, 'virtual:dashboard-extensions');
        expect(result).toBe('\0virtual:dashboard-extensions');
    });

    it('resolveId returns undefined for other IDs', () => {
        const plugin = setupPlugin([]);
        const result = callResolveId(plugin, 'some-other-module');
        expect(result).toBeUndefined();
    });

    it('load generates runDashboardExtensions with correct import statements', async () => {
        const plugin = setupPlugin([
            {
                name: 'TestPlugin',
                pluginPath: '/path/to/plugin.js',
                dashboardEntryPath: './dashboard/index.tsx',
            },
        ]);
        const fakeContext = { debug: noop, info: noop };
        const result = await callLoad(plugin, fakeContext, '\0virtual:dashboard-extensions');
        expect(result).toContain('runDashboardExtensions');
        const expectedPath = path.resolve('/path/to', './dashboard/index.tsx');
        expect(result).toContain(pathToFileURL(expectedPath).toString());
    });

    it('load handles multiple extensions', async () => {
        const plugin = setupPlugin([
            {
                name: 'PluginA',
                pluginPath: '/a/plugin.js',
                dashboardEntryPath: './dashboard/index.tsx',
            },
            { name: 'PluginB', pluginPath: '/b/plugin.js', dashboardEntryPath: './ui/entry.tsx' },
        ]);
        const fakeContext = { debug: noop, info: noop };
        const result = await callLoad(plugin, fakeContext, '\0virtual:dashboard-extensions');
        const expectedA = pathToFileURL(path.resolve('/a', './dashboard/index.tsx')).toString();
        const expectedB = pathToFileURL(path.resolve('/b', './ui/entry.tsx')).toString();
        expect(result).toContain(expectedA);
        expect(result).toContain(expectedB);
    });

    it('load handles zero extensions', async () => {
        const plugin = setupPlugin([]);
        const fakeContext = { debug: noop, info: noop };
        const result = await callLoad(plugin, fakeContext, '\0virtual:dashboard-extensions');
        expect(result).toContain('runDashboardExtensions');
        // No import() calls
        expect(result).not.toContain('await import');
    });

    it('load skips plugins without dashboardEntryPath', async () => {
        const plugin = setupPlugin([
            { name: 'NoDashboard', pluginPath: '/x/plugin.js', dashboardEntryPath: undefined },
            {
                name: 'WithDashboard',
                pluginPath: '/y/plugin.js',
                dashboardEntryPath: './dashboard/index.tsx',
            },
        ]);
        const fakeContext = { debug: noop, info: noop };
        const result = await callLoad(plugin, fakeContext, '\0virtual:dashboard-extensions');
        const expectedY = pathToFileURL(path.resolve('/y', './dashboard/index.tsx')).toString();
        expect(result).toContain(expectedY);
        // Only one import
        expect((result.match(/await import/g) || []).length).toBe(1);
    });

    it('load returns undefined for non-matching IDs', async () => {
        const plugin = setupPlugin([]);
        const fakeContext = { debug: noop, info: noop };
        const result = await callLoad(plugin, fakeContext, 'some-other-id');
        expect(result).toBeUndefined();
    });
});

// ─── hmrPlugin ──────────────────────────────────────────────────────────────

describe('hmrPlugin', () => {
    function setupHmrPlugin(viteRoot: string) {
        const plugin = hmrPlugin();
        callConfigResolved(plugin, { root: viteRoot });
        return plugin;
    }

    function createHmrContext(viteRoot: string, modules: Array<{ file: string | null }>) {
        const sendSpy = vi.fn();
        const invalidateSpy = vi.fn();
        const ctx = {
            server: {
                hot: { send: sendSpy },
                moduleGraph: { invalidateModule: invalidateSpy },
            },
            modules,
            timestamp: Date.now(),
            file: modules[0]?.file ?? '',
        };
        return { ctx, sendSpy, invalidateSpy };
    }

    it('triggers full-reload for files outside vite root', () => {
        const plugin = setupHmrPlugin('/app/src');
        const { ctx, sendSpy, invalidateSpy } = createHmrContext('/app/src', [
            { file: '/outside/extensions/plugin.ts' },
        ]);
        const result = callHandleHotUpdate(plugin, ctx);
        expect(sendSpy).toHaveBeenCalledOnce();
        expect(sendSpy).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
        expect(invalidateSpy).toHaveBeenCalledOnce();
        expect(result).toEqual([]);
    });

    it('returns undefined for files inside vite root (normal HMR)', () => {
        const plugin = setupHmrPlugin('/app/src');
        const { ctx, sendSpy, invalidateSpy } = createHmrContext('/app/src', [
            { file: '/app/src/components/Button.tsx' },
        ]);
        const result = callHandleHotUpdate(plugin, ctx);
        expect(sendSpy).not.toHaveBeenCalled();
        expect(invalidateSpy).toHaveBeenCalledOnce();
        expect(result).toBeUndefined();
    });

    it('reloads on first outside-root module in mixed list', () => {
        const plugin = setupHmrPlugin('/app/src');
        const { ctx, sendSpy, invalidateSpy } = createHmrContext('/app/src', [
            { file: '/app/src/components/Button.tsx' },
            { file: '/outside/extensions/plugin.ts' },
        ]);
        const result = callHandleHotUpdate(plugin, ctx);
        expect(sendSpy).toHaveBeenCalledOnce();
        expect(sendSpy).toHaveBeenCalledWith({ type: 'full-reload', path: '*' });
        // Both modules should be invalidated before the early return on the second
        expect(invalidateSpy).toHaveBeenCalledTimes(2);
        expect(result).toEqual([]);
    });

    it('stops processing after first outside-root module', () => {
        const plugin = setupHmrPlugin('/app/src');
        const { ctx, sendSpy, invalidateSpy } = createHmrContext('/app/src', [
            { file: '/outside/extensions/plugin.ts' },
            { file: '/app/src/components/Button.tsx' },
        ]);
        const result = callHandleHotUpdate(plugin, ctx);
        expect(sendSpy).toHaveBeenCalledOnce();
        // Only the first module is invalidated — early return skips the second
        expect(invalidateSpy).toHaveBeenCalledOnce();
        expect(result).toEqual([]);
    });

    it('invalidates all inside-root modules and returns undefined', () => {
        const plugin = setupHmrPlugin('/app/src');
        const { ctx, sendSpy, invalidateSpy } = createHmrContext('/app/src', [
            { file: '/app/src/components/A.tsx' },
            { file: '/app/src/components/B.tsx' },
            { file: '/app/src/components/C.tsx' },
        ]);
        const result = callHandleHotUpdate(plugin, ctx);
        expect(sendSpy).not.toHaveBeenCalled();
        expect(invalidateSpy).toHaveBeenCalledTimes(3);
        expect(result).toBeUndefined();
    });
});

// ─── dashboardTailwindSourcePlugin ───────────────────────────────────────────

describe('dashboardTailwindSourcePlugin', () => {
    function setupPlugin(pluginInfo: PluginInfo[]) {
        return setupConfigLoaderPlugin(dashboardTailwindSourcePlugin(), pluginInfo);
    }

    const markerComment =
        '/* @source rules from extensions will be added here by the dashboardTailwindSourcePlugin */';

    it('returns undefined for non-styles.css files', async () => {
        const plugin = setupPlugin([]);
        const result = await callTransformWithContext(plugin, {}, 'body {}', '/app/main.css');
        expect(result).toBeUndefined();
    });

    it('injects @source directives after the marker comment', async () => {
        const plugin = setupPlugin([
            {
                name: 'TestPlugin',
                pluginPath: '/ext/plugin.js',
                dashboardEntryPath: './dashboard/index.tsx',
            },
        ]);
        const css = `@tailwind base;\n${markerComment}\n@tailwind components;`;
        const result = await callTransformWithContext(plugin, {}, css, '/some/app/styles.css');
        expect(result.code).toContain(markerComment);
        expect(result.code).toContain("@source '");
        // The @source directive line should appear right after the marker comment
        const lines: string[] = result.code.split('\n');
        const markerIdx: number = lines.findIndex((l: string) => l.includes(markerComment));
        const sourceIdx: number = lines.findIndex((l: string) => l.trimStart().startsWith("@source '"));
        expect(sourceIdx).toBe(markerIdx + 1);
    });

    it('appends @source directives at end if marker comment not found', async () => {
        const plugin = setupPlugin([
            {
                name: 'TestPlugin',
                pluginPath: '/ext/plugin.js',
                dashboardEntryPath: './dashboard/index.tsx',
            },
        ]);
        const css = '@tailwind base;\n@tailwind components;';
        const result = await callTransformWithContext(plugin, {}, css, '/some/app/styles.css');
        expect(result.code).toContain("@source '");
        // Source should be at the end
        expect(result.code.endsWith("';")).toBe(true);
    });

    it('handles zero extensions (no @source directives)', async () => {
        const plugin = setupPlugin([]);
        const css = `@tailwind base;\n${markerComment}\n@tailwind components;`;
        const result = await callTransformWithContext(plugin, {}, css, '/some/app/styles.css');
        // The empty sources string is still spliced in, but no actual @source directive exists
        const hasSourceDirective = result.code
            .split('\n')
            .some((l: string) => l.trimStart().startsWith("@source '"));
        expect(hasSourceDirective).toBe(false);
    });

    // Tests for the bundle-mode (#4719 `useExperimentalBundle`) extension entry
    describe('useExperimentalBundle: extension-tailwind.css handling', () => {
        function setupBundlePlugin(pluginInfo: PluginInfo[], packageRoot = '/fake/dashboard') {
            return setupConfigLoaderPlugin(
                dashboardTailwindSourcePlugin({ packageRoot, useExperimentalBundle: true }),
                pluginInfo,
            );
        }

        it('also matches extension-tailwind.css', async () => {
            const plugin = setupBundlePlugin([]);
            const css = `@tailwind utilities;\n${markerComment}\n`;
            const result = await callTransformWithContext(
                plugin,
                {},
                css,
                '/some/app/extension-tailwind.css',
            );
            // The result is defined (the transform ran) — confirms the file matched
            expect(result).toBeDefined();
            expect(result.code).toContain(markerComment);
        });

        it('adds @source for the bundle dir when transforming extension-tailwind.css', async () => {
            const packageRoot = '/fake/dashboard';
            const plugin = setupBundlePlugin([], packageRoot);
            const css = `@tailwind utilities;\n${markerComment}\n`;
            const result = await callTransformWithContext(
                plugin,
                {},
                css,
                '/some/app/extension-tailwind.css',
            );
            expect(result.code).toContain(
                `@source '${path.join(packageRoot, 'dist/bundle')}'`,
            );
        });

        it('does NOT add bundle @source when transforming the regular styles.css (only extension-tailwind.css)', async () => {
            const packageRoot = '/fake/dashboard';
            const plugin = setupBundlePlugin([], packageRoot);
            const css = `@tailwind utilities;\n${markerComment}\n`;
            const result = await callTransformWithContext(
                plugin,
                {},
                css,
                '/some/app/styles.css',
            );
            // Bundle source dir should not appear; styles.css is the source-mode entry
            expect(result.code).not.toContain('dist/bundle');
        });

        it('without useExperimentalBundle: extension-tailwind.css still transforms but no bundle @source', async () => {
            const plugin = setupConfigLoaderPlugin(dashboardTailwindSourcePlugin(), []);
            const css = `@tailwind utilities;\n${markerComment}\n`;
            const result = await callTransformWithContext(
                plugin,
                {},
                css,
                '/some/app/extension-tailwind.css',
            );
            // Transform fires (matches the file) but no bundle dir is injected
            expect(result).toBeDefined();
            expect(result.code).not.toContain('dist/bundle');
        });
    });
});

// ─── bundleEntryPlugin (#4719) ───────────────────────────────────────────────

describe('bundleEntryPlugin', () => {
    /**
     * The plugin's transformIndexHtml is the object form: `{ order, handler }`.
     * This helper extracts the actual handler so we can call it consistently
     * with how Vite would.
     */
    function callBundleEntryTransform(
        plugin: Plugin,
        html: string,
        ctx: { filename: string },
    ) {
        const hook = plugin.transformIndexHtml as
            | ((html: string, ctx: { filename: string }) => any)
            | { order?: 'pre' | 'post'; handler: (html: string, ctx: { filename: string }) => any };
        if (typeof hook === 'function') return hook(html, ctx);
        return hook.handler(html, ctx);
    }

    const sourceEntryHtml = [
        '<html>',
        '<head></head>',
        '<body>',
        '<div id="app"></div>',
        '<script type="module" src="/src/app/main.jsx"></script>',
        '</body>',
        '</html>',
    ].join('\n');

    it('declares transformIndexHtml with order: pre', () => {
        const plugin = bundleEntryPlugin();
        const hook = plugin.transformIndexHtml as any;
        // We use the object form to pin ordering — confirm the shape is intact
        expect(hook).toBeTypeOf('object');
        expect(hook.order).toBe('pre');
        expect(hook.handler).toBeTypeOf('function');
    });

    it('replaces the source-entry script with the bundled entry + CSS link', () => {
        const plugin = bundleEntryPlugin();
        const result = callBundleEntryTransform(plugin, sourceEntryHtml, {
            filename: 'index.html',
        });
        expect(result).toContain('/dist/bundle/main.js');
        expect(result).toContain('/dist/bundle/dashboard.css');
        expect(result).toContain('<link rel="stylesheet"');
        expect(result).not.toContain('/src/app/main.jsx');
    });

    it('matches the script src even when Vite has already prepended the base path', () => {
        const plugin = bundleEntryPlugin();
        const htmlWithBase = sourceEntryHtml.replace(
            'src="/src/app/main.jsx"',
            'src="/dashboard/src/app/main.jsx"',
        );
        const result = callBundleEntryTransform(plugin, htmlWithBase, {
            filename: 'index.html',
        });
        expect(result).toContain('/dist/bundle/main.js');
        expect(result).not.toContain('main.jsx');
    });

    it('leaves HTML unchanged when the source-entry script is not present', () => {
        const plugin = bundleEntryPlugin();
        const unrelatedHtml = '<html><body><script src="/other.js"></script></body></html>';
        const result = callBundleEntryTransform(plugin, unrelatedHtml, {
            filename: 'index.html',
        });
        expect(result).toBe(unrelatedHtml);
    });

    it('passes Storybook HTML through unchanged', () => {
        const plugin = bundleEntryPlugin();
        const result = callBundleEntryTransform(plugin, sourceEntryHtml, {
            filename: 'iframe.html',
        });
        expect(result).toBe(sourceEntryHtml);
    });
});

// ─── viteConfigPlugin: useExperimentalBundle (#4719) ─────────────────────────

describe('viteConfigPlugin: useExperimentalBundle', () => {
    const packageRoot = '/fake/dashboard';

    it('without flag: no @vendure/dashboard alias (defaults to source-shipping)', () => {
        const plugin = viteConfigPlugin({ packageRoot });
        const result = callConfig(plugin, {}, { command: 'serve' });
        const aliases = result.resolve.alias as Record<string, string>;
        expect(aliases['@vendure/dashboard']).toBeUndefined();
    });

    it('with flag: adds Vite resolve alias @vendure/dashboard -> dist/bundle/lib.js', () => {
        const plugin = viteConfigPlugin({ packageRoot, useExperimentalBundle: true });
        const result = callConfig(plugin, {}, { command: 'serve' });
        const aliases = result.resolve.alias as Record<string, string>;
        expect(aliases['@vendure/dashboard']).toBe(
            path.resolve(packageRoot, './dist/bundle/lib.js'),
        );
    });

    it('with flag: still keeps @/vdb and @/graphql aliases', () => {
        const plugin = viteConfigPlugin({ packageRoot, useExperimentalBundle: true });
        const result = callConfig(plugin, {}, { command: 'serve' });
        const aliases = result.resolve.alias as Record<string, string>;
        expect(aliases['@/vdb']).toBe(path.resolve(packageRoot, './src/lib'));
        expect(aliases['@/graphql']).toBe(path.resolve(packageRoot, './src/lib/graphql'));
    });

    it('optimizeDeps.exclude always includes virtual:plugin-translations (regardless of flag)', () => {
        const off = callConfig(viteConfigPlugin({ packageRoot }), {}, { command: 'serve' });
        const on = callConfig(
            viteConfigPlugin({ packageRoot, useExperimentalBundle: true }),
            {},
            { command: 'serve' },
        );
        expect(off.optimizeDeps.exclude).toContain('virtual:plugin-translations');
        expect(on.optimizeDeps.exclude).toContain('virtual:plugin-translations');
    });

    it('optimizeDeps.exclude still contains @vendure/dashboard + @/vdb in both modes', () => {
        // Source-mode needs them excluded so Vite doesn't try to pre-bundle the
        // dashboard source. Bundle-mode keeps them excluded as well so Vite's
        // dep scanner doesn't walk into the dashboard's source files for things
        // like `await import('virtual:plugin-translations')` in load-i18n-messages.
        const off = callConfig(viteConfigPlugin({ packageRoot }), {}, { command: 'serve' });
        const on = callConfig(
            viteConfigPlugin({ packageRoot, useExperimentalBundle: true }),
            {},
            { command: 'serve' },
        );
        expect(off.optimizeDeps.exclude).toContain('@vendure/dashboard');
        expect(off.optimizeDeps.exclude).toContain('@/vdb');
        expect(on.optimizeDeps.exclude).toContain('@vendure/dashboard');
        expect(on.optimizeDeps.exclude).toContain('@/vdb');
    });
});
