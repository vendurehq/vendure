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
    const line = stdout
        .split('\n')
        .map(l => l.trim())
        .find(l => l.startsWith('CLOUD_RESULT '));
    if (!line) {
        throw new Error(`No CLOUD_RESULT line in CLI output:\n${stdout}`);
    }
    return JSON.parse(line.slice('CLOUD_RESULT '.length));
}

describe('CLI plugin nested commands', () => {
    let project: CliTestProject;

    beforeAll(() => {
        project = createTestProject('cli-plugin-nested');
        installCliPluginFixture(project, 'cloud-cli-plugin');
    });

    afterAll(() => {
        project.cleanup();
    });

    it('runs a two-level plugin command', async () => {
        const result = await project.runCliCommand(['project', 'list']);

        expect(result.exitCode).toBe(0);
        expect(parseCloudResult(result.stdout).command).toEqual(['project', 'list']);
    });

    it('runs a three-level plugin command with positional arguments', async () => {
        const result = await project.runCliCommand(['config', 'server', 'set', 'apiPort', '3001']);

        const parsed = parseCloudResult(result.stdout);
        expect(parsed.command).toEqual(['config', 'server', 'set']);
        expect(parsed.positionals).toEqual(['apiPort', '3001']);
    });

    it('runs a three-level plugin command without arguments', async () => {
        const result = await project.runCliCommand(['backup', 'db', 'list']);

        expect(parseCloudResult(result.stdout).command).toEqual(['backup', 'db', 'list']);
    });

    it('runs a two-level plugin command with an argument', async () => {
        const result = await project.runCliCommand(['restore', 'db', 'backup-42']);

        const parsed = parseCloudResult(result.stdout);
        expect(parsed.command).toEqual(['restore', 'db']);
        expect(parsed.positionals).toEqual(['backup-42']);
    });

    it('passes shared options given before the command path', async () => {
        const result = await project.runCliCommand([
            '--token',
            'tok-1',
            '--project',
            'my-project',
            '--environment',
            'staging',
            '--json',
            'project',
            'list',
        ]);

        expect(parseCloudResult(result.stdout).inherited).toEqual({
            token: 'tok-1',
            project: 'my-project',
            environment: 'staging',
            json: true,
        });
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
        // command declares its own, so both must still see the value.
        const result = await project.runCliCommand(['plugins', '--json']);

        expect(result.exitCode).toBe(0);
        expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('rejects a group option outside its group', async () => {
        const result = await project.runCliCommand(['project', 'list', '--profile', 'ci'], {
            expectError: true,
        });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown option '--profile'");
    });
});

describe('CLI plugin help output', () => {
    let project: CliTestProject;

    beforeAll(() => {
        project = createTestProject('cli-plugin-help');
        installCliPluginFixture(project, 'cloud-cli-plugin');
    });

    afterAll(() => {
        project.cleanup();
    });

    it('shows plugin commands and shared options in root help', async () => {
        const result = await project.runCliCommand(['--help']);

        for (const name of ['project', 'config', 'backup', 'restore']) {
            expect(result.stdout).toContain(name);
        }
        for (const option of ['--token', '--project', '--environment', '--json']) {
            expect(result.stdout).toContain(option);
        }
    });

    it('shows subcommands and inherited options in parent help', async () => {
        const result = await project.runCliCommand(['config', '--help']);

        expect(result.stdout).toContain('vendure config');
        expect(result.stdout).toContain('server');
        expect(result.stdout).toContain('--profile');
        expect(result.stdout).toContain('Global Options:');
        expect(result.stdout).toContain('--token');
    });

    it('shows the options valid at every level in leaf help', async () => {
        const result = await project.runCliCommand(['config', 'server', 'set', '--help']);

        expect(result.stdout).toContain('vendure config server set [options] <key> <value>');
        expect(result.stdout).toContain('Global Options:');
        expect(result.stdout).toContain('--profile');
        expect(result.stdout).toContain('--environment');
    });

    it('prints help and fails when a group is run without a subcommand', async () => {
        const result = await project.runCliCommand(['backup'], { expectError: true });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('vendure backup');
        expect(result.stderr).toContain('db');
    });

    it('fails on an unknown subcommand', async () => {
        const result = await project.runCliCommand(['project', 'destroy'], { expectError: true });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown command 'destroy'");
    });

    it('fails on an unknown option', async () => {
        const result = await project.runCliCommand(['project', 'list', '--nope'], { expectError: true });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown option '--nope'");
    });

    it('fails on a missing required argument', async () => {
        const result = await project.runCliCommand(['config', 'server', 'set', 'apiPort'], {
            expectError: true,
        });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("missing required argument 'value'");
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
            installCliPluginFixture(project, 'cloud-cli-plugin');
            installCliPluginFixture(project, 'option-collision-cli-plugin');

            const result = await project.runCliCommand(['project', 'list', '--token', 'tok']);

            expect(result.stderr).toContain('Failed to register CLI plugin');
            expect(result.stderr).toContain('is already registered by @vendure-e2e/cloud-cli-plugin');
            expect(parseCloudResult(result.stdout).inherited.token).toBe('tok');

            const rival = await project.runCliCommand(['rival'], { expectError: true });
            expect(rival.exitCode).toBe(1);
            expect(rival.stderr).toContain('Unknown command "rival"');
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
