/*
 * E2E tests for several CLI plugins extending the same command.
 *
 * These spawn the built CLI (`dist/cli.js`) against a temporary project, with
 * one fixture standing in for `@vendure-platform/cli` and another for
 * `@vendure/cloud`, both wrapping the built-in `dev`.
 *
 * `dev bogus` is used to drive the whole chain: the built-in rejects an unknown
 * target before it starts any process, so the test observes both wrappers and
 * the built-in running without a server being spawned. The built-in reports the
 * bad target through the CLI logger and returns exit code 1.
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
        const result = await project.runCliCommand(['dev', 'bogus'], { expectError: true });

        expect(traceOf(result.stdout)).toEqual([
            'CLOUD_BEFORE',
            'PLATFORM_BEFORE',
            'PLATFORM_AFTER',
            'CLOUD_AFTER',
        ]);
        // The built-in ran: it is what rejects the unknown target, and it
        // reports through the CLI's own logger rather than throwing.
        expect(result.stdout).toContain('Unknown dev target "bogus"');
        expect(result.exitCode).toBe(1);
    });

    it('gives each wrapper the options and context the host parsed', async () => {
        const result = await project.runCliCommand(
            ['dev', 'bogus', '--rotate-credential', '--cloud-env', 'staging'],
            { expectError: true },
        );

        expect(readMarker(result.stdout, 'PLATFORM_BEFORE')).toEqual({
            command: ['dev'],
            rotate: true,
        });
        expect(readMarker(result.stdout, 'CLOUD_BEFORE').cloudEnv).toBe('staging');
    });

    it('hands the outer plugin the command the inner one already extended', async () => {
        const result = await project.runCliCommand(['dev', 'bogus'], { expectError: true });

        // The Cloud fixture is listed last, so it sees the option Platform added.
        expect(readMarker(result.stdout, 'CLOUD_BEFORE').sawOptions).toContain('--rotate-credential');
    });

    it('shows every plugin option in dev help', async () => {
        const result = await project.runCliCommand(['dev', '--help']);

        expect(result.stdout).toContain('--rotate-credential');
        expect(result.stdout).toContain('--cloud-env');
        // The built-in options survive.
        expect(result.stdout).toContain('--no-reload');
        expect(result.stdout).toContain('--server-entry');
    });

    it('shows the extended description in root help', async () => {
        const result = await project.runCliCommand(['--help']);

        expect(result.stdout).toContain('Run Vendure in development mode with linked Platform credentials');
    });

    it('still rejects an unknown option on the extended command', async () => {
        const result = await project.runCliCommand(['dev', '--nope'], { expectError: true });

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

            const result = await project.runCliCommand(['dev', 'bogus'], { expectError: true });

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

            const result = await project.runCliCommand(['dev', 'bogus'], { expectError: true });

            expect(result.stderr).toContain('Failed to register CLI plugin');
            expect(result.stderr).toContain('This decorator is broken on purpose');
            expect(result.stderr).toContain(`vendure plugins remove ${broken}`);
            // The working plugin is untouched, and nothing from the broken one landed.
            expect(traceOf(result.stdout)).toEqual(['PLATFORM_BEFORE', 'PLATFORM_AFTER']);

            const unknown = await project.runCliCommand(['broken-extra'], { expectError: true });
            expect(unknown.exitCode).toBe(1);
            expect(unknown.stderr).toContain('Unknown command "broken-extra"');

            const removed = await project.runCliCommand(['plugins', 'remove', broken]);
            expect(removed.exitCode).toBe(0);
            expect(readEnabledCliPlugins(project)).not.toContain(broken);
        } finally {
            project.cleanup();
        }
    });

    it('refuses to replace a command another plugin has extended', async () => {
        const project = createTestProject('cli-plugin-replace-extended');
        try {
            const platform = installCliPluginFixture(project, 'platform-cli-plugin');
            installCliPluginFixture(project, 'dev-replacement-cli-plugin');

            const result = await project.runCliCommand(['dev', 'bogus'], { expectError: true });

            expect(result.stderr).toContain(`has been extended by ${platform}`);
            expect(result.stdout).not.toContain('REPLACEMENT_DEV');
            expect(traceOf(result.stdout)).toEqual(['PLATFORM_BEFORE', 'PLATFORM_AFTER']);
        } finally {
            project.cleanup();
        }
    });

    it('extends a replacement when the replacing plugin is listed first', async () => {
        const project = createTestProject('cli-plugin-replace-then-extend');
        try {
            installCliPluginFixture(project, 'dev-replacement-cli-plugin');
            installCliPluginFixture(project, 'platform-cli-plugin');

            const result = await project.runCliCommand(['dev']);

            expect(result.exitCode).toBe(0);
            expect(result.stdout).toContain('REPLACEMENT_DEV');
            expect(traceOf(result.stdout)).toEqual(['PLATFORM_BEFORE', 'PLATFORM_AFTER']);
        } finally {
            project.cleanup();
        }
    });
});
