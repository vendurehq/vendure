import { existsSync } from 'node:fs';
import { mkdir, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { debugLogger, noopLogger } from '../utils/logger.js';
import { discoverPlugins } from '../utils/plugin-discovery.js';

/**
 * Regression for the monorepo-dev case: a plugin shipped as a workspace package
 * (symlinked into node_modules) that carries a dashboard extension. Such a
 * package is followed as source but its compiled `.js` is never globbed
 * (followSymbolicLinks: false + the config compiler skips package imports), so
 * before the source-registration pass in `discoverPlugins` it fell between both
 * discovery paths and its dashboard was never registered.
 *
 * The symlink is created at runtime rather than committed, since symlinked
 * fixtures don't travel reliably across platforms/checkouts.
 */
describe('detecting dashboard in workspace-symlinked packages', () => {
    const fixtureDir = join(__dirname, 'fixtures-symlinked-workspace');
    const workspacePkg = join(fixtureDir, 'workspace-package');
    const fakeNodeModules = join(fixtureDir, 'fake_node_modules');
    const symlinkPath = join(fakeNodeModules, 'test-workspace-plugin');
    const tempDir = join(__dirname, './__temp/symlinked-workspace');
    const logger = process.env.LOG ? debugLogger : noopLogger;
    let pluginInfo: Awaited<ReturnType<typeof discoverPlugins>>;

    beforeAll(async () => {
        await rm(tempDir, { recursive: true, force: true });
        await mkdir(tempDir, { recursive: true });
        await mkdir(fakeNodeModules, { recursive: true });
        await rm(symlinkPath, { force: true }).catch(() => undefined);
        // node_modules/test-workspace-plugin -> ../workspace-package
        // The target lives outside node_modules, which is what marks it as a
        // workspace (rather than installed) package to the discovery scanner.
        await symlink(workspacePkg, symlinkPath, 'dir');

        pluginInfo = await discoverPlugins({
            vendureConfigPath: join(fixtureDir, 'vendure-config.ts'),
            outputPath: tempDir,
            transformTsConfigPathMappings: ({ patterns }) => patterns,
            logger,
            pluginPackageScanner: { nodeModulesRoot: fakeNodeModules },
        });
    });

    afterAll(async () => {
        await rm(symlinkPath, { force: true }).catch(() => undefined);
        await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    });

    it('registers the dashboard entry from the plugin source', () => {
        const plugin = pluginInfo.find(p => p.name === 'TestWorkspacePlugin');
        expect(plugin).toBeDefined();
        expect(plugin?.dashboardEntryPath).toBe('./dashboard/index.tsx');
        // Resolved from source, so it points at the editable src/dashboard entry.
        const sourcePlugin = join(workspacePkg, 'src', 'plugin.ts');
        expect(plugin?.sourcePluginPath).toBe(sourcePlugin);
        expect(plugin?.pluginPath).toBe(sourcePlugin);

        // The entry resolves (as the metadata plugin does) to a real source file.
        const resolvedEntry = resolve(join(workspacePkg, 'src'), plugin.dashboardEntryPath);
        expect(existsSync(resolvedEntry)).toBe(true);
    });

    it('skips a workspace plugin whose dashboard entry does not exist', () => {
        // The broken plugin is dropped...
        expect(pluginInfo.find(p => p.name === 'TestBrokenDashboardPlugin')).toBeUndefined();
        // ...but its valid sibling is still discovered.
        expect(pluginInfo.find(p => p.name === 'TestWorkspacePlugin')).toBeDefined();
    });
});
