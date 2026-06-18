import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import tsconfigPaths from 'tsconfig-paths';
import { describe, expect, it } from 'vitest';

import { compile } from '../utils/compiler.js';
import { debugLogger, noopLogger } from '../utils/logger.js';

// #4542 — scanner should follow transitive dependencies of imported packages
// to discover Vendure plugins inside "meta-packages" that internally configure
// many plugins. The meta-plugin's package.json dependencies are checked: any dep
// that has @vendure/core in its own dependencies or peerDependencies is added to
// the scan list. `unrelated-lib` (no @vendure/core) and `missing-dep` (not on disk)
// are intentionally present to test filtering and error resilience.
describe('detecting plugins via meta-package transitive dependencies', () => {
    const fakeNodeModules = join(__dirname, 'fixtures-meta-package', 'fake_node_modules');
    const logger = process.env.LOG ? debugLogger : noopLogger;

    it(
        'should discover plugins from transitive dependencies of imported packages',
        { timeout: 60_000 },
        async () => {
            const tempDir = join(__dirname, './__temp/meta-package');
            await rm(tempDir, { recursive: true, force: true });

            tsconfigPaths.register({
                baseUrl: fakeNodeModules,
                paths: {
                    'meta-plugin': [join(fakeNodeModules, 'meta-plugin')],
                },
            });

            const result = await compile({
                outputPath: tempDir,
                vendureConfigPath: join(__dirname, 'fixtures-meta-package', 'vendure-config.ts'),
                logger,
                pluginPackageScanner: {
                    nodeModulesRoot: fakeNodeModules,
                },
            });

            // child-plugin-a (peerDeps), child-plugin-b (peerDeps), child-plugin-c (deps)
            // are discovered. unrelated-lib and missing-dep are not.
            expect(result.pluginInfo).toHaveLength(3);

            const sorted = [...result.pluginInfo].sort((a, b) => a.name.localeCompare(b.name));
            expect(sorted.map(p => p.name)).toEqual(['ChildPluginA', 'ChildPluginB', 'ChildPluginC']);

            expect(sorted[0].dashboardEntryPath).toBe('./dashboard/index.tsx');
            expect(sorted[0].pluginPath).toBe(join(fakeNodeModules, 'child-plugin-a', 'index.js'));
            expect(sorted[0].sourcePluginPath).toBeUndefined();

            expect(sorted[1].dashboardEntryPath).toBe('./dashboard/index.tsx');
            expect(sorted[1].pluginPath).toBe(join(fakeNodeModules, 'child-plugin-b', 'index.js'));
            expect(sorted[1].sourcePluginPath).toBeUndefined();

            // child-plugin-c has @vendure/core in dependencies (not peerDependencies)
            expect(sorted[2].dashboardEntryPath).toBe('./dashboard/index.tsx');
            expect(sorted[2].pluginPath).toBe(join(fakeNodeModules, 'child-plugin-c', 'index.js'));
            expect(sorted[2].sourcePluginPath).toBeUndefined();
        },
    );

    // When a plugin is imported directly in the config AND also listed as a
    // transitive dep of the meta-package, it should appear only once.
    it(
        'should deduplicate plugins imported both directly and transitively',
        { timeout: 60_000 },
        async () => {
            const tempDir = join(__dirname, './__temp/meta-package-dedup');
            await rm(tempDir, { recursive: true, force: true });

            tsconfigPaths.register({
                baseUrl: fakeNodeModules,
                paths: {
                    'meta-plugin': [join(fakeNodeModules, 'meta-plugin')],
                    'child-plugin-a': [join(fakeNodeModules, 'child-plugin-a')],
                },
            });

            const result = await compile({
                outputPath: tempDir,
                vendureConfigPath: join(__dirname, 'fixtures-meta-package', 'vendure-config-dedup.ts'),
                logger,
                pluginPackageScanner: {
                    nodeModulesRoot: fakeNodeModules,
                },
            });

            // child-plugin-a is imported directly AND is a dep of meta-plugin,
            // but should only appear once in the results.
            const pluginAInstances = result.pluginInfo.filter(p => p.name === 'ChildPluginA');
            expect(pluginAInstances).toHaveLength(1);

            // All 3 child plugins should still be discovered
            expect(result.pluginInfo).toHaveLength(3);
        },
    );
});
