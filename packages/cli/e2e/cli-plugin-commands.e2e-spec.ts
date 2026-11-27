/*
 * E2E tests for how the CLI discovers, enables and recovers from CLI plugins.
 *
 * These spawn the built CLI (`dist/cli.js`) against a temporary project, so they
 * exercise plugin discovery, activation and loading the same way a real installation does.
 * The commands of a plugin come from its command manifest, which
 * cli-plugin-defined-commands.e2e-spec.ts covers.
 *
 * To run these tests:
 * npm run vitest -- --config e2e/vitest.e2e.config.mts
 */
import { describe, expect, it } from 'vitest';

import { createTestProject, installCliPluginFixture, readEnabledCliPlugins } from './cli-test-utils.js';

describe('CLI plugin discovery without activation', () => {
    it('does not load a plugin that is installed but not enabled', async () => {
        const project = createTestProject('cli-plugin-inactive');
        try {
            const packageName = installCliPluginFixture(project, 'cloud-cli-plugin', { enable: false });

            // The hint is suppressed for --help and for `plugins` itself,
            // so drive it with an ordinary command that exits quickly.
            const hinted = await project.runCliCommand(['dev', 'bogus'], { expectError: true });
            expect(hinted.stderr).toContain('Run "vendure plugins" to review them.');

            // The command it declares is not registered, but the CLI knows
            // which package would provide it, from its command manifest.
            const unknown = await project.runCliCommand(['project', 'list'], { expectError: true });
            expect(unknown.exitCode).toBe(1);
            expect(unknown.stderr).toContain('Unknown command "project"');
            expect(unknown.stderr).toContain(`It is provided by ${packageName}`);
            expect(unknown.stderr).toContain(`vendure plugins add ${packageName}`);
        } finally {
            project.cleanup();
        }
    });
});

// CLO-1562: enabling a package the project has not installed named a listing
// that did not exist instead of the missing install.
describe('CLI plugin enabling', () => {
    it('says the package is not installed, and how to install it', async () => {
        const project = createTestProject('cli-plugin-add-not-installed');
        try {
            project.writeFile('bun.lock', '');

            const result = await project.runCliCommand(['plugins', 'add', '@vendure-e2e/cloud-cli-plugin'], {
                expectError: true,
            });
            const output = result.stdout + result.stderr;

            expect(result.exitCode).toBe(1);
            expect(output).toContain('@vendure-e2e/cloud-cli-plugin is not installed in ');
            expect(output).toContain('Install it with: bun add -D @vendure-e2e/cloud-cli-plugin');
            expect(output).not.toContain('Listed in vendure.cli.plugins');
            expect(readEnabledCliPlugins(project)).toEqual([]);
        } finally {
            project.cleanup();
        }
    });
});

describe('CLI plugin recovery', () => {
    it('keeps "vendure plugins remove" reachable when a plugin is broken', async () => {
        const project = createTestProject('cli-plugin-broken');
        try {
            const packageName = installCliPluginFixture(project, 'broken-cli-plugin');

            const listed = await project.runCliCommand(['plugins']);
            expect(listed.stderr).toContain('Failed to load CLI plugin');
            expect(listed.stdout).toContain(packageName);

            const removed = await project.runCliCommand(['plugins', 'remove', packageName]);
            expect(removed.exitCode).toBe(0);
            expect(readEnabledCliPlugins(project)).not.toContain(packageName);
        } finally {
            project.cleanup();
        }
    });

    it('keeps "vendure plugins remove" reachable when a plugin\'s command clashes', async () => {
        const project = createTestProject('cli-plugin-collision-recovery');
        try {
            const packageName = installCliPluginFixture(project, 'clashing-defined-commands-cli-plugin');

            const removed = await project.runCliCommand(['plugins', 'remove', packageName]);

            expect(removed.exitCode).toBe(0);
            expect(readEnabledCliPlugins(project)).not.toContain(packageName);
        } finally {
            project.cleanup();
        }
    });
});

describe('CLI plugin that still declares commands', () => {
    it('is reported with plugin.commands-removed, and the CLI keeps working', async () => {
        const project = createTestProject('cli-plugin-commands-removed');
        try {
            const packageName = installCliPluginFixture(project, 'removed-commands-cli-plugin');

            const result = await project.runCliCommand(['plugins']);

            expect(result.exitCode).toBe(0);
            expect(result.stderr).toContain('Failed to load CLI plugin');
            expect(result.stderr).toContain('[plugin.commands-removed]');
            expect(result.stdout).toContain(packageName);

            // The command it declared is not registered, and the built-ins still run.
            const unknown = await project.runCliCommand(['legacy-extra'], { expectError: true });
            expect(unknown.exitCode).toBe(1);
            expect(unknown.stderr).toContain('Unknown command "legacy-extra"');
            const commands = await project.runCliCommand(['commands', '--json']);
            expect(commands.exitCode).toBe(0);

            const removed = await project.runCliCommand(['plugins', 'remove', packageName]);
            expect(removed.exitCode).toBe(0);
        } finally {
            project.cleanup();
        }
    });
});
