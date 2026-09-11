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

import { sectionAfter } from '../src/shared/__tests__/help-sections';

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

describe('CLI plugin commands that also have subcommands', () => {
    let project: CliTestProject;

    beforeAll(() => {
        project = createTestProject('cli-plugin-runnable-parent');
        installCliPluginFixture(project, 'cloud-cli-plugin');
    });

    afterAll(() => {
        project?.cleanup();
    });

    it('runs the parent action when no subcommand is given', async () => {
        const result = await project.runCliCommand(['deploy', '--env', 'staging']);

        expect(result.exitCode).toBe(0);
        const parsed = parseCloudResult(result.stdout);
        expect(parsed.command).toEqual(['deploy']);
        expect(parsed.options).toEqual({ env: 'staging' });
    });

    it('runs a subcommand of a runnable parent', async () => {
        const plan = await project.runCliCommand(['deploy', 'plan']);
        const teardown = await project.runCliCommand(['deploy', 'teardown']);

        expect(parseCloudResult(plan.stdout).command).toEqual(['deploy', 'plan']);
        expect(parseCloudResult(teardown.stdout).command).toEqual(['deploy', 'teardown']);
    });

    it('shares a parent option with its subcommands', async () => {
        const result = await project.runCliCommand(['deploy', 'plan', '--env', 'staging']);

        const parsed = parseCloudResult(result.stdout);
        expect(parsed.inherited.env).toBe('staging');
        // The parent owns the option, so it is not one of the subcommand's own.
        expect(parsed.options).toEqual({});
    });

    it('runs a runnable parent nested inside a group, and its subcommands', async () => {
        const db = await project.runCliCommand(['backup', 'db', '--label', 'nightly']);
        const list = await project.runCliCommand(['backup', 'db', 'list']);
        const status = await project.runCliCommand(['backup', 'db', 'status', '--label', 'nightly']);

        expect(parseCloudResult(db.stdout).command).toEqual(['backup', 'db']);
        expect(parseCloudResult(db.stdout).options).toEqual({ label: 'nightly' });
        expect(parseCloudResult(list.stdout).command).toEqual(['backup', 'db', 'list']);
        expect(parseCloudResult(status.stdout).command).toEqual(['backup', 'db', 'status']);
        expect(parseCloudResult(status.stdout).inherited.label).toBe('nightly');
    });

    it('keeps the shared root options in scope below a runnable parent', async () => {
        const result = await project.runCliCommand(['deploy', 'plan', '--token', 'tok', '--json']);

        expect(parseCloudResult(result.stdout).inherited).toEqual({ token: 'tok', json: true });
    });

    it('reports a mistyped subcommand rather than running the parent', async () => {
        const result = await project.runCliCommand(['deploy', 'plann'], { expectError: true });

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("unknown command 'plann'");
        // The same suggestion a command group gives for the same mistake.
        expect(result.stderr).toContain('(Did you mean plan?)');
        expect(result.stdout).not.toContain('CLOUD_RESULT');
    });

    it('keeps a help subcommand on a command that has an action', async () => {
        const result = await project.runCliCommand(['deploy', 'help']);

        expect(result.stdout).toMatch(/^\s+plan\s+Show what a deploy would change$/m);
        expect(result.stdout).not.toContain('CLOUD_RESULT');
    });

    it('rejects a plugin whose command has both arguments and subcommands', async () => {
        const broken = createTestProject('cli-plugin-ambiguous-parent');
        try {
            installCliPluginFixture(broken, 'ambiguous-parent-cli-plugin');
            const result = await broken.runCliCommand(['--help']);

            expect(result.stderr).toContain('declares both positional arguments and subcommands');
            // The plugin is skipped rather than taking the CLI down with it.
            expect(result.stdout).toContain('plugins');
        } finally {
            broken.cleanup();
        }
    });

    it('lists the subcommands of a runnable parent nested inside a group', async () => {
        const result = await project.runCliCommand(['backup', 'db', '--help']);

        expect(result.stdout).toContain('Usage: vendure backup db');
        expect(result.stdout).toMatch(/^\s+list\s+List database backups$/m);
        expect(result.stdout).toMatch(/^\s+status\s+Show the status of a backup$/m);
    });

    it("lists a runnable parent's subcommands and its own options in help", async () => {
        const result = await project.runCliCommand(['deploy', '--help']);

        expect(result.stdout).toContain('Usage: vendure deploy [options] [command]');
        expect(result.stdout).toMatch(/^\s+plan\s+Show what a deploy would change$/m);
        expect(result.stdout).toMatch(/^\s+teardown\s+Tear the deployment down$/m);
        expect(result.stdout).toMatch(/^\s+--env /m);
        expect(result.stdout).toContain('Global Options:');
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
        expect(result.stdout).toMatch(/^\s+deploy \[options\]\s+Deploy the application$/m);
        for (const option of ['--token', '--project', '--environment', '--json']) {
            expect(result.stdout).toMatch(new RegExp(`^\\s+${option}`, 'm'));
        }
    });

    it('lists the plugin commands under a heading naming the package', async () => {
        const result = await project.runCliCommand(['--help']);

        // Asserted by section, not by string offset: the section a command is
        // listed in is what says where it came from.
        const pluginSection = sectionAfter(result.stdout, 'Commands from @vendure-e2e/cloud-cli-plugin:');
        expect(pluginSection).toMatch(/^\s+project\s+Manage Cloud projects$/m);
        expect(pluginSection).toMatch(/^\s+deploy \[options\]\s+Deploy the application$/m);

        const builtinSection = sectionAfter(result.stdout, 'Commands:');
        expect(builtinSection).toMatch(/^\s+add \[options\]\s+Add a feature to your Vendure project$/m);
        expect(builtinSection).not.toContain('Manage Cloud projects');
    });

    it('lists the plugin shared options under a heading naming the package', async () => {
        const result = await project.runCliCommand(['--help']);

        const pluginSection = sectionAfter(result.stdout, 'Options from @vendure-e2e/cloud-cli-plugin:');
        expect(pluginSection).toMatch(/^\s+--token /m);
        expect(pluginSection).toMatch(/^\s+--project /m);

        // --help is the CLI's own and stays under Commander's own heading.
        const builtinSection = sectionAfter(result.stdout, 'Options:');
        expect(builtinSection).toMatch(/^\s+-h, --help/m);
        expect(builtinSection).not.toContain('--token');
    });

    // Whether the CLI colours its output depends on the environment it is
    // spawned in, so both directions are pinned here: the suite itself runs
    // both ways depending on whether it is invoked through Lerna.
    it('colours the headings only when the environment allows colour', async () => {
        const coloured = await project.runCliCommand(['--help'], { env: { FORCE_COLOR: '1' } });

        // Bold heading, with the package name tinted inside the same bold run.
        expect(coloured.rawStdout).toContain('\u001b[1mCommands from \u001b[36m');
        // Assertions are made against the stripped output, whatever the colour.
        expect(coloured.stdout).toContain('Commands from @vendure-e2e/cloud-cli-plugin:');
    });

    it('emits no colour when NO_COLOR is set', async () => {
        const plain = await project.runCliCommand(['--help'], {
            env: { NO_COLOR: '1', FORCE_COLOR: '1' },
        });

        expect(plain.rawStdout).not.toContain('\u001b[');
        expect(plain.rawStdout).toContain('Commands from @vendure-e2e/cloud-cli-plugin:');
    });

    it('names the commands a plugin provides in the plugins listing', async () => {
        const result = await project.runCliCommand(['plugins']);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('@vendure-e2e/cloud-cli-plugin');
        expect(result.stdout).toMatch(/commands:.*\bdeploy\b/);
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
