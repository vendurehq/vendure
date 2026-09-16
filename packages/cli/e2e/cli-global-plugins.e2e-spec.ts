import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
    createSimulatedGlobalInstall,
    createTestProject,
    CliTestProject,
    SimulatedGlobalInstall,
} from './cli-test-utils';

/**
 * Exercises the CLI as it behaves when installed globally: its own package
 * inside a global `node_modules`, plugin packages beside it, and no project in
 * the directory it is run from.
 *
 * The rest of the e2e suite runs `dist/cli.js` straight out of the repository,
 * where the CLI is not inside any `node_modules` at all, so nothing there can
 * reach this code path.
 */
describe('Globally installed CLI plugins E2E', () => {
    let globalInstall: SimulatedGlobalInstall | undefined;
    let project: CliTestProject | undefined;

    afterEach(() => {
        globalInstall?.cleanup();
        globalInstall = undefined;
        project?.cleanup();
        project = undefined;
    });

    it('reports a globally installed plugin that is not enabled, and how to enable it', async () => {
        globalInstall = createSimulatedGlobalInstall(['cloud-cli-plugin']);

        const result = await globalInstall.runCliCommand(['project', 'list']);

        expect(result.stderr).toContain('Unknown command "project"');
        expect(result.stderr).toContain('installed but not enabled');
        expect(result.stderr).toContain('vendure plugins add --global @vendure-e2e/cloud-cli-plugin');
        expect(result.exitCode).toBe(1);
    });

    it('runs a globally enabled plugin command from a directory with no project', async () => {
        globalInstall = createSimulatedGlobalInstall(['cloud-cli-plugin']);

        const enabled = await globalInstall.runCliCommand([
            'plugins',
            'add',
            '--global',
            '@vendure-e2e/cloud-cli-plugin',
        ]);
        expect(enabled.stdout).toContain('for this machine');

        const result = await globalInstall.runCliCommand(['project', 'list']);

        expect(result.stdout).toContain('CLOUD_RESULT');
        expect(result.exitCode).toBe(0);
    });

    it('enables a plugin from the environment alone, writing nothing', async () => {
        globalInstall = createSimulatedGlobalInstall(['cloud-cli-plugin']);

        const result = await globalInstall.runCliCommand(['project', 'list'], {
            env: { VENDURE_CLI_PLUGINS: '@vendure-e2e/cloud-cli-plugin' },
        });

        expect(result.stdout).toContain('CLOUD_RESULT');
        expect(result.exitCode).toBe(0);
    });

    it('reports the global scope for a globally installed plugin', async () => {
        globalInstall = createSimulatedGlobalInstall(['cloud-cli-plugin']);

        const result = await globalInstall.runCliCommand(['plugins', '--json']);

        const { plugins } = JSON.parse(result.stdout);
        expect(plugins).toEqual([
            expect.objectContaining({
                packageName: '@vendure-e2e/cloud-cli-plugin',
                scope: 'global',
                status: 'not-enabled',
            }),
        ]);
    });

    it('reports an unreadable machine-wide config as a file, not as a package', async () => {
        globalInstall = createSimulatedGlobalInstall([]);
        writeFileSync(globalInstall.configPath, '{ not json');

        const result = await globalInstall.runCliCommand(['--version']);

        expect(result.stderr).toContain('No CLI plugins were loaded from it');
        expect(result.stderr).toContain(globalInstall.configPath);
        // A file has no package name and cannot be disabled like one.
        expect(result.stderr).not.toContain('Failed to load CLI plugin');
        expect(result.stderr).not.toContain('plugins remove');
    });

    /**
     * The case that made the global scope wrong: with the CLI installed as a
     * project devDependency, the `node_modules` it sits in is the project's
     * own. Reporting those packages as machine-wide listed every project
     * dependency twice and offered to enable one for the whole machine.
     */
    it('does not report a project dependency as a machine-wide plugin', async () => {
        project = createTestProject('global-scope-isolation');
        const { installCliPluginFixture } = await import('./cli-test-utils');
        const packageName = installCliPluginFixture(project, 'cloud-cli-plugin');

        const result = await project.runCliCommand(['plugins', '--json']);

        const { plugins } = JSON.parse(result.stdout);
        expect(plugins).toEqual([
            expect.objectContaining({ packageName, scope: 'project', status: 'enabled' }),
        ]);
    });
});
