/*
 * E2E tests for CLI plugins that register nested command trees and shared options.
 *
 * These spawn the built CLI (`dist/cli.js`) against a temporary project, so they
 * exercise plugin discovery, activation, registration and Commander parsing the
 * same way a real installation does.
 *
 * To run these tests:
 * npm run vitest -- --config e2e/vitest.e2e.config.mts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    CliTestProject,
    createTestProject,
    installCliPluginFixture,
    readEnabledCliPlugins,
    readMarker,
} from './cli-test-utils';

interface CloudResult {
    command: string[];
    positionals: string[];
    options: Record<string, any>;
    inherited: Record<string, any>;
}

/**
 * Reads back the line the fixture plugin prints, which is everything the CLI
 * host passed to the command action.
 */
function parseCloudResult(stdout: string): CloudResult {
    return readMarker(stdout, 'CLOUD_RESULT');
}

describe('CLI plugin nested commands', () => {
    let project: CliTestProject;

    beforeAll(() => {
        project = createTestProject('cli-plugin-nested');
        installCliPluginFixture(project, 'cloud-cli-plugin');
    });

    afterAll(() => {
        project?.cleanup();
    });

    it('runs a two-level plugin command', async () => {
        const result = await project.runCliCommand(['project', 'list']);

        expect(result.exitCode).toBe(0);
        expect(parseCloudResult(result.stdout).command).toEqual(['project', 'list']);
    });

    it('passes shared options given after the command path', async () => {
        const result = await project.runCliCommand([
            'config',
            'server',
            'set',
            'apiPort',
            '3001',
            '--token',
            'tok-2',
            '--project',
            'my-project',
            '--environment',
            'prod',
            '--json',
        ]);

        expect(parseCloudResult(result.stdout).inherited).toEqual({
            token: 'tok-2',
            project: 'my-project',
            environment: 'prod',
            json: true,
        });
    });

    it('passes a leaf command its own options', async () => {
        const result = await project.runCliCommand(['project', 'list', '--limit', '5']);

        expect(parseCloudResult(result.stdout).options).toEqual({ limit: '5' });
    });

    it('passes a group option alongside the shared options', async () => {
        const result = await project.runCliCommand([
            'config',
            '--profile',
            'ci',
            'server',
            'set',
            'apiPort',
            '3001',
            '--token',
            'tok-3',
        ]);

        expect(parseCloudResult(result.stdout).inherited).toEqual({ profile: 'ci', token: 'tok-3' });
    });

    it('leaves a built-in option of the same name working', async () => {
        // The plugin registers a shared `--json` and the built-in `plugins`
        // command declares its own. That both readings agree is pinned by the
        // unit test in command-registry.spec.ts; here we only prove the
        // built-in still produces its JSON output.
        const result = await project.runCliCommand(['plugins', '--json']);

        expect(result.exitCode).toBe(0);
        const listed = JSON.parse(result.stdout);
        const entry = listed.plugins.find(
            (plugin: any) => plugin.packageName === '@vendure-e2e/cloud-cli-plugin',
        );
        // A plugin that failed to load is still listed, so the status is the
        // part that proves --json reached a working built-in.
        expect(entry?.status).toBe('enabled');
    });
});

describe('CLI plugin help output', () => {
    let project: CliTestProject;

    beforeAll(() => {
        project = createTestProject('cli-plugin-help');
        installCliPluginFixture(project, 'cloud-cli-plugin');
    });

    afterAll(() => {
        project?.cleanup();
    });

    it('shows plugin commands and shared options in root help', async () => {
        const result = await project.runCliCommand(['--help']);

        // Anchored on the command list: these words also appear in built-in
        // descriptions and option names, so `toContain` would pass regardless.
        expect(result.stdout).toMatch(/^\s+project\s+Manage Cloud projects$/m);
        expect(result.stdout).toMatch(/^\s+config \[options\]\s+Manage Cloud configuration$/m);
        expect(result.stdout).toMatch(/^\s+backup\s+Manage backups$/m);
        expect(result.stdout).toMatch(/^\s+restore\s+Restore from a backup$/m);
        for (const option of ['--token', '--project', '--environment', '--json']) {
            expect(result.stdout).toMatch(new RegExp(`^\\s+${option}`, 'm'));
        }
    });

    it('shows the options valid at every level in leaf help', async () => {
        const result = await project.runCliCommand(['config', 'server', 'set', '--help']);

        expect(result.stdout).toContain('vendure config server set [options] <key> <value>');
        expect(result.stdout).toContain('Global Options:');
        expect(result.stdout).toContain('--profile');
        expect(result.stdout).toContain('--environment');
    });
});

describe('CLI plugin collisions', () => {
    it('skips a plugin that would take over a built-in command', async () => {
        const project = createTestProject('cli-plugin-command-collision');
        try {
            installCliPluginFixture(project, 'command-collision-cli-plugin');

            const result = await project.runCliCommand(['add', '--help']);

            expect(result.stderr).toContain('Failed to register CLI plugin');
            expect(result.stderr).toContain('Command "add" is already provided by the CLI');
            expect(result.stderr).toContain('vendure plugins remove');
            expect(result.stdout).not.toContain('Silently takes over');
            expect(result.stdout).toContain('Add a feature to your Vendure project');
        } finally {
            project.cleanup();
        }
    });

    it('replaces a built-in command when the plugin declares it', async () => {
        const project = createTestProject('cli-plugin-replaces');
        try {
            installCliPluginFixture(project, 'replacing-cli-plugin');

            const result = await project.runCliCommand(['doctor']);

            expect(result.stdout).toContain('REPLACED_DOCTOR');
            expect(result.stderr).toContain('Replaced command "doctor"');
        } finally {
            project.cleanup();
        }
    });

    it('skips a plugin whose shared option is already registered', async () => {
        const project = createTestProject('cli-plugin-option-collision');
        try {
            const cloud = installCliPluginFixture(project, 'cloud-cli-plugin');
            installCliPluginFixture(project, 'option-collision-cli-plugin');

            const result = await project.runCliCommand(['project', 'list', '--token', 'tok']);

            expect(result.stderr).toContain('Failed to register CLI plugin');
            expect(result.stderr).toContain(`is already registered by ${cloud}`);
            expect(parseCloudResult(result.stdout).inherited.token).toBe('tok');

            const rival = await project.runCliCommand(['rival'], { expectError: true });
            expect(rival.exitCode).toBe(1);
            expect(rival.stderr).toContain('Unknown command "rival"');
        } finally {
            project.cleanup();
        }
    });
});

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
            // which package would provide it, from vendure.cliCommands.
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

    it('keeps "vendure plugins remove" reachable when a plugin collides', async () => {
        const project = createTestProject('cli-plugin-collision-recovery');
        try {
            const packageName = installCliPluginFixture(project, 'command-collision-cli-plugin');

            const removed = await project.runCliCommand(['plugins', 'remove', packageName]);

            expect(removed.exitCode).toBe(0);
            expect(readEnabledCliPlugins(project)).not.toContain(packageName);
        } finally {
            project.cleanup();
        }
    });
});
