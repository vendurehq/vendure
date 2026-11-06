import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { debugLogger, noopLogger } from '../utils/logger.js';
import { discoverPlugins } from '../utils/plugin-discovery.js';

/**
 * Covers guessing the node_modules root when `pluginPackageScanner.nodeModulesRoot`
 * is not given. Under vitest `import.meta.resolve` is unavailable, so the guess
 * always takes its fallback: walking up from the Vendure config file until it finds
 * a node_modules directory containing `@vendure/core`. The fixture tree is built at
 * runtime because a directory literally named `node_modules` cannot be committed.
 */
describe('guessing the node_modules root without an explicit override', () => {
    const fixtureRoot = join(__dirname, './__temp/node-modules-root');
    const nodeModules = join(fixtureRoot, 'node_modules');
    // The config sits two directories below the node_modules parent, so the
    // plugin is only found if the upward walk works.
    const configDir = join(fixtureRoot, 'app', 'src');
    const outputDir = join(fixtureRoot, 'output');
    const logger = process.env.LOG ? debugLogger : noopLogger;
    let pluginInfo: Awaited<ReturnType<typeof discoverPlugins>>;

    beforeAll(async () => {
        await rm(fixtureRoot, { recursive: true, force: true });
        await mkdir(configDir, { recursive: true });
        await mkdir(outputDir, { recursive: true });

        // A stub @vendure/core marks this node_modules as the one holding installed
        // packages. It must stop the upward walk here rather than at the repo root.
        const coreStub = join(nodeModules, '@vendure', 'core');
        await mkdir(coreStub, { recursive: true });
        await writeFile(
            join(coreStub, 'package.json'),
            JSON.stringify({ name: '@vendure/core', version: '0.0.0', main: 'index.js' }),
        );
        await writeFile(join(coreStub, 'index.js'), '');

        // Reuse the compiled npm-plugin fixture as an installed plugin package.
        await cp(
            join(__dirname, 'fixtures-npm-plugin', 'fake_node_modules', 'test-plugin'),
            join(nodeModules, 'test-plugin'),
            { recursive: true },
        );

        await writeFile(
            join(configDir, 'vendure-config.ts'),
            [
                "import { TestPlugin } from 'test-plugin';",
                '',
                'export const config = {',
                '    plugins: [TestPlugin],',
                '};',
                '',
            ].join('\n'),
        );

        pluginInfo = await discoverPlugins({
            vendureConfigPath: join(configDir, 'vendure-config.ts'),
            outputPath: outputDir,
            transformTsConfigPathMappings: ({ patterns }) => patterns,
            logger,
        });
    });

    afterAll(async () => {
        await rm(fixtureRoot, { recursive: true, force: true }).catch(() => undefined);
    });

    it('finds the plugin via the node_modules directory that contains @vendure/core', () => {
        const plugin = pluginInfo.find(p => p.name === 'TestPlugin');
        expect(plugin).toBeDefined();
        expect(plugin?.dashboardEntryPath).toBe('./dashboard/index.tsx');
        // The plugin path shows which node_modules the guess landed on.
        expect(plugin?.pluginPath).toBe(join(nodeModules, 'test-plugin', 'index.js'));
    });
});
