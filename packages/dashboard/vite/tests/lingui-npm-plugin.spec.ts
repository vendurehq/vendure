import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import tsconfigPaths from 'tsconfig-paths';
import { build, type Plugin, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

import { compile } from '../utils/compiler.js';
import { debugLogger, noopLogger } from '../utils/logger.js';
import { linguiBabelPlugin } from '../vite-plugin-lingui-babel.js';

/**
 * Runs a single module through a real Vite build with the given plugin, so the plugin's
 * hook filter, environment setup and (parallel) Babel workers are all exercised.
 * Every import is external, so the output shows which imports remain after the transform.
 */
async function transformWithVite(plugin: Plugin, id: string, code: string): Promise<string> {
    const result = await build({
        configFile: false,
        logLevel: 'silent',
        plugins: [
            {
                name: 'test-entry',
                enforce: 'pre',
                resolveId: source => (source === id ? id : undefined),
                load: loadId => (loadId === id ? code : undefined),
            },
            plugin,
        ],
        build: {
            write: false,
            minify: false,
            lib: { entry: id, formats: ['es'], fileName: 'out' },
            rolldownOptions: { external: source => source !== id },
        },
    });
    const output = (Array.isArray(result) ? result[0] : result) as Rolldown.RolldownOutput;
    return output.output[0].code;
}

/**
 * Integration tests for the linguiBabelPlugin with actual npm packages.
 *
 * These tests verify that:
 * 1. The plugin discovery mechanism correctly identifies npm packages with dashboard extensions
 * 2. The linguiBabelPlugin transforms Lingui macros in those discovered packages
 *
 * This addresses the bug where third-party npm packages (like @vendure-ee/*) with
 * dashboard extensions using Lingui macros would fail to build because the macros
 * weren't being transformed.
 *
 * @see LINGUI_BABEL_PLUGIN_BUG.md
 */
describe('linguiBabelPlugin with npm packages containing Lingui macros', () => {
    const fixtureDir = join(__dirname, 'fixtures-lingui-npm-plugin');
    const fakeNodeModules = join(fixtureDir, 'fake_node_modules');
    const tempDir = join(__dirname, './__temp/lingui-npm-plugin');

    it('should discover npm plugin and transform its Lingui macros', { timeout: 60_000 }, async () => {
        // Clean up temp directory
        await rm(tempDir, { recursive: true, force: true });

        // Register tsconfig paths so the test can resolve the fake npm package
        tsconfigPaths.register({
            baseUrl: fakeNodeModules,
            paths: {
                '@test-scope/lingui-plugin': [join(fakeNodeModules, '@test-scope/lingui-plugin')],
            },
        });

        // Step 1: Compile and discover plugins (like the real build process does)
        const result = await compile({
            outputPath: tempDir,
            vendureConfigPath: join(fixtureDir, 'vendure-config.ts'),
            logger: process.env.LOG ? debugLogger : noopLogger,
            pluginPackageScanner: {
                nodeModulesRoot: fakeNodeModules,
            },
        });

        // Verify the plugin was discovered
        expect(result.pluginInfo).toHaveLength(1);
        expect(result.pluginInfo[0].name).toBe('LinguiTestPlugin');
        expect(result.pluginInfo[0].dashboardEntryPath).toBe('./dashboard/index.tsx');
        expect(result.pluginInfo[0].sourcePluginPath).toBeUndefined(); // npm package, not local

        // Step 2: Extract the package path from the discovered plugin
        // (This is what the linguiBabelPlugin does in configResolved)
        const pluginPath = result.pluginInfo[0].pluginPath;
        expect(pluginPath).toContain('@test-scope/lingui-plugin');

        // Extract package name from path (simulating extractPackagePath)
        const packageName = '@test-scope/lingui-plugin';

        // Step 3: Create linguiBabelPlugin with the discovered package
        const plugin = linguiBabelPlugin({
            additionalPackagePaths: [packageName],
        });

        // Step 4: Read the actual dashboard file that contains Lingui macros
        const dashboardFilePath = join(fakeNodeModules, '@test-scope/lingui-plugin/dashboard/index.tsx');
        const dashboardCode = await readFile(dashboardFilePath, 'utf-8');

        // Verify the file contains Lingui macros before transformation
        expect(dashboardCode).toContain("from '@lingui/react/macro'");
        expect(dashboardCode).toContain("from '@lingui/core/macro'");
        expect(dashboardCode).toContain('<Trans>');
        expect(dashboardCode).toContain('t`');

        // Step 5: Transform the file using linguiBabelPlugin
        const transformed = await transformWithVite(plugin, dashboardFilePath, dashboardCode);

        // Step 6: Verify the macros were transformed
        // The transformed code should NOT contain macro imports
        expect(transformed).not.toMatch(/@lingui\/(react|core)\/macro/);

        // The transformed code should contain the runtime imports instead
        expect(transformed).toContain('@lingui/react');
        expect(transformed).toContain('@lingui/core');
    });

    it('should NOT transform Lingui macros in undiscovered npm packages', { timeout: 60_000 }, async () => {
        // Create plugin WITHOUT the package in additionalPackagePaths
        // (simulating a package that wasn't discovered as a Vendure plugin)
        const plugin = linguiBabelPlugin({
            additionalPackagePaths: [], // Empty - no packages discovered
        });

        // Read the dashboard file
        const dashboardFilePath = join(fakeNodeModules, '@test-scope/lingui-plugin/dashboard/index.tsx');
        const dashboardCode = await readFile(dashboardFilePath, 'utf-8');

        // Build it - the macros must be left alone because the package isn't in the allowlist
        const transformed = await transformWithVite(plugin, dashboardFilePath, dashboardCode);

        // File was skipped because it's in node_modules and not discovered: the macro imports remain
        expect(transformed).toContain('@lingui/react/macro');
        expect(transformed).toContain('@lingui/core/macro');
    });

    it(
        'should still transform @vendure/dashboard source files without discovery',
        { timeout: 60_000 },
        async () => {
            // Create plugin with no discovered packages
            const plugin = linguiBabelPlugin();

            const code = `
import { Trans } from '@lingui/react/macro';
export function MyComponent() {
    return <Trans>Hello</Trans>;
}
`;
            // Simulate a file from @vendure/dashboard/src
            const id = join(fakeNodeModules, '@vendure/dashboard/src/components/Test.tsx');

            const transformed = await transformWithVite(plugin, id, code);

            // Should transform because @vendure/dashboard/src is always allowed
            expect(transformed).not.toContain('@lingui/react/macro');
            expect(transformed).toContain('@lingui/react');
        },
    );

    it('should still transform local files without discovery', { timeout: 60_000 }, async () => {
        // Create plugin with no discovered packages
        const plugin = linguiBabelPlugin();

        const code = `
import { Trans } from '@lingui/react/macro';
export function MyComponent() {
    return <Trans>Hello</Trans>;
}
`;
        // Simulate a local file (not in node_modules)
        const id = '/path/to/project/src/plugins/my-plugin/dashboard/Test.tsx';

        const transformed = await transformWithVite(plugin, id, code);

        // Should transform because local files are always allowed
        expect(transformed).not.toContain('@lingui/react/macro');
        expect(transformed).toContain('@lingui/react');
    });
});

describe('linguiBabelPlugin parsing and errors', () => {
    const projectDir = '/path/to/project/src/plugins/my-plugin/dashboard';

    // A `<T>x` type assertion only parses when JSX is off, and JSX only parses when it is on,
    // so each extension must get the right parser. Builds use the parallel Babel workers.
    it.each([
        {
            file: 'cast.ts',
            code: `import { t } from '@lingui/core/macro';
const value: unknown = 'World';
export const message = t\`Hello \${<string>value}\`;`,
        },
        {
            file: 'component.tsx',
            code: `import { Trans } from '@lingui/react/macro';
export function Greeting(props: { name: string }) {
    return <Trans>Hello {props.name}</Trans>;
}`,
        },
        {
            file: 'module.mts',
            code: `import { t } from '@lingui/core/macro';
export const greet = (name: string): string => t\`Hello \${<string>name}\`;`,
        },
        {
            file: 'module.cts',
            code: `import { t } from '@lingui/core/macro';
export const greet = (name: string): string => t\`Hello \${<string>name}\`;`,
        },
    ])('compiles the macros in $file', { timeout: 60_000 }, async ({ file, code }) => {
        const transformed = await transformWithVite(linguiBabelPlugin(), `${projectDir}/${file}`, code);

        expect(transformed).not.toMatch(/@lingui\/(react|core)\/macro/);
        expect(transformed).toMatch(/@lingui\/(react|core)/);
    });

    it(
        'fails the build with the file name when Babel cannot compile a macro file',
        { timeout: 60_000 },
        async () => {
            const id = `${projectDir}/broken.ts`;
            const code = `import { t } from '@lingui/core/macro';
export const message = t\`Hello\`;
export const = 1;`;

            await expect(transformWithVite(linguiBabelPlugin(), id, code)).rejects.toThrow(
                /BabelError[\s\S]*broken\.ts|broken\.ts[\s\S]*BabelError/,
            );
        },
    );
});
