/*
 * E2E tests for several CLI plugins extending the same command.
 *
 * These spawn the built CLI (`dist/cli.js`) against a temporary project, with
 * one fixture standing in for `@vendure-platform/cli` and another for
 * `@vendure/cloud`, both wrapping the built-in `start`. `vendure dev` is declared
 * with `defineCommand`, which these Commander extensions cannot wrap.
 *
 * `start bogus` is used to drive the whole chain: the built-in rejects an unknown
 * target before it starts any process, so the test observes both wrappers and
 * the built-in running without a server being spawned. The built-in reports the
 * bad target through the CLI logger and returns exit code 1.
 *
 * To run these tests:
 * npm run vitest -- --config e2e/vitest.e2e.config.mts
 */
import { mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    CliTestProject,
    createTestProject,
    installCliPluginFixture,
    readEnabledCliPlugins,
    readMarker,
} from './cli-test-utils.js';

/**
 * The markers each layer prints, in the order they appear in the output.
 */
function traceOf(stdout: string): string[] {
    return stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^(PLATFORM|CLOUD)_(BEFORE|AFTER)/.test(line))
        .map(line => line.split(' ')[0]);
}

describe('Several plugins extending one command', () => {
    let project: CliTestProject;

    beforeAll(() => {
        project = createTestProject('cli-plugin-extensions');
        installCliPluginFixture(project, 'platform-cli-plugin');
        installCliPluginFixture(project, 'cloud-dev-cli-plugin');
    });

    afterAll(() => {
        project?.cleanup();
    });

    it('runs both wrappers and the built-in in one invocation', async () => {
        const result = await project.runCliCommand(['start', 'bogus'], { expectError: true });

        expect(traceOf(result.stdout)).toEqual([
            'CLOUD_BEFORE',
            'PLATFORM_BEFORE',
            'PLATFORM_AFTER',
            'CLOUD_AFTER',
        ]);
        // The built-in ran: it is what rejects the unknown target, and it
        // reports through the CLI's own logger rather than throwing.
        expect(result.stdout).toContain('Unknown start target "bogus"');
        expect(result.exitCode).toBe(1);
    });

    it('gives each wrapper the options and context the host parsed', async () => {
        const result = await project.runCliCommand(
            ['start', 'bogus', '--rotate-credential', '--cloud-env', 'staging'],
            { expectError: true },
        );

        expect(readMarker(result.stdout, 'PLATFORM_BEFORE')).toEqual({
            command: ['start'],
            rotate: true,
        });
        expect(readMarker(result.stdout, 'CLOUD_BEFORE').cloudEnv).toBe('staging');
    });

    it('hands the outer plugin the command the inner one already extended', async () => {
        const result = await project.runCliCommand(['start', 'bogus'], { expectError: true });

        // The Cloud fixture is listed last, so it sees the option Platform added.
        expect(readMarker(result.stdout, 'CLOUD_BEFORE').sawOptions).toContain('--rotate-credential');
    });

    it('shows every plugin option in start help', async () => {
        const result = await project.runCliCommand(['start', '--help']);

        expect(result.stdout).toContain('--rotate-credential');
        expect(result.stdout).toContain('--cloud-env');
        // The built-in options survive.
        expect(result.stdout).toContain('--server-entry');
    });

    it('shows the extended description in root help', async () => {
        const result = await project.runCliCommand(['--help']);

        expect(result.stdout).toContain('Start a built Vendure project with linked Platform credentials');
    });

    it('still rejects an unknown option on the extended command', async () => {
        const result = await project.runCliCommand(['start', '--nope'], { expectError: true });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unknown option '--nope'");
    });
});

describe('Extension order follows the activation order', () => {
    it('makes the last listed plugin the outermost wrapper', async () => {
        const project = createTestProject('cli-plugin-extensions-reversed');
        try {
            installCliPluginFixture(project, 'cloud-dev-cli-plugin');
            installCliPluginFixture(project, 'platform-cli-plugin');

            const result = await project.runCliCommand(['start', 'bogus'], { expectError: true });

            expect(traceOf(result.stdout)).toEqual([
                'PLATFORM_BEFORE',
                'CLOUD_BEFORE',
                'CLOUD_AFTER',
                'PLATFORM_AFTER',
            ]);
            expect(readMarker(result.stdout, 'CLOUD_BEFORE').sawOptions).not.toContain('--rotate-credential');
        } finally {
            project.cleanup();
        }
    });
});

describe('Extension collisions and recovery', () => {
    it('skips a plugin whose decorator fails to apply, keeping the others', async () => {
        const project = createTestProject('cli-plugin-broken-decorator');
        try {
            installCliPluginFixture(project, 'platform-cli-plugin');
            const broken = installCliPluginFixture(project, 'broken-decorator-cli-plugin');

            const result = await project.runCliCommand(['start', 'bogus'], { expectError: true });

            expect(result.stderr).toContain('Failed to register CLI plugin');
            expect(result.stderr).toContain('This decorator is broken on purpose');
            expect(result.stderr).toContain(`vendure plugins remove ${broken}`);
            // The working plugin is untouched, and nothing from the broken one landed.
            expect(traceOf(result.stdout)).toEqual(['PLATFORM_BEFORE', 'PLATFORM_AFTER']);

            const removed = await project.runCliCommand(['plugins', 'remove', broken]);
            expect(removed.exitCode).toBe(0);
            expect(readEnabledCliPlugins(project)).not.toContain(broken);
        } finally {
            project.cleanup();
        }
    });
});

describe('Workspace project plugin loading', () => {
    let project: CliTestProject;
    const extension = '@vendure-e2e/extension-cli-plugin';

    beforeAll(() => {
        project = createTestProject('cli-workspace-plugins');
        // A plugin that extends `dev` shows which project's plugins were loaded for it: its flag
        // is in the help of `dev` only when the plugin loaded.
        installCliPluginFixture(project, 'extension-cli-plugin');
        const server = path.join(project.projectDir, 'server');
        mkdirSync(server);
        for (const name of ['package.json', 'node_modules']) {
            renameSync(path.join(project.projectDir, name), path.join(server, name));
        }
        project.writeFile('package.json', JSON.stringify({ workspaces: ['server'] }));
    });

    afterAll(() => project.cleanup());

    it.each([['dev'], ['dev', '--dir', 'server'], ['dev', '--dir=server']])(
        'loads the member plugin before parsing %j',
        async (...args) => {
            const result = await project.runCliCommand([...args, '--help']);
            expect(result.stdout).toContain('--cloud-project');
        },
    );

    it('uses the member allowlist for plugin management', async () => {
        const listed = await project.runCliCommand(['plugins', '--json']);
        expect(JSON.parse(listed.stdout).plugins).toContainEqual(
            expect.objectContaining({ packageName: extension, scope: 'project', status: 'enabled' }),
        );
        try {
            await project.runCliCommand(['plugins', 'remove', extension]);
            expect(JSON.parse(project.readFile('server/package.json')).vendure.cli.plugins).toEqual([]);
            expect(JSON.parse(project.readFile('package.json')).vendure).toBeUndefined();
        } finally {
            await project.runCliCommand(['plugins', 'add', extension]);
        }
    });

    it('rejects an invalid explicit project before loading plugins', async () => {
        const result = await project.runCliCommand(['dev', '--dir', 'missing'], { expectError: true });
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Invalid --dir directory');
        expect(result.stdout).not.toContain('--cloud-project');
    });

    it('reports ambiguous members and lets --dir select one', async () => {
        project.writeFile('other/package.json', JSON.stringify({ dependencies: { '@vendure/core': '*' } }));
        project.writeFile('package.json', JSON.stringify({ workspaces: ['server', 'other'] }));
        try {
            const result = await project.runCliCommand(['dev'], { expectError: true });
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(
                `Multiple Vendure projects found in "${project.projectDir}": other, server.`,
            );
            expect(result.stderr).toContain('Use --dir <dir>');
            expect(result.stdout).not.toContain('--cloud-project');
            const help = await project.runCliCommand(['--help']);
            expect(help.stdout).toContain('Usage: vendure');
            expect(help.stderr).toContain('Multiple Vendure projects found');
            const doctor = await project.runCliCommand(['doctor', '--format', 'json'], { expectError: true });
            expect(() => JSON.parse(doctor.stdout)).not.toThrow();
            const rootPackage = project.readFile('package.json');
            const serverPackage = project.readFile('server/package.json');
            const removed = await project.runCliCommand(['plugins', 'remove', extension], {
                expectError: true,
            });
            expect(removed.exitCode).toBe(1);
            expect(removed.stderr).toContain('Multiple Vendure projects found');
            expect(project.readFile('package.json')).toBe(rootPackage);
            expect(project.readFile('server/package.json')).toBe(serverPackage);

            const selected = await project.runCliCommand(['dev', '--dir', 'server', '--help']);
            expect(selected.stdout).toContain('--cloud-project');
        } finally {
            project.writeFile('package.json', JSON.stringify({ workspaces: ['server'] }));
        }
    });
});
