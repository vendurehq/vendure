import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConsoleLinkContext } from '../../index.js';
import { CliCommandExit } from '../../shared/cli-command-exit.js';

import { ConsoleReporter } from './console-reporter.js';
import {
    createCliConfigDir,
    createVendureProject,
    fakeConsole,
    manifest as legacyManifest,
    storeLogin,
} from './console.fixtures.js';
import { ConsoleCommandDependencies, ConsoleCommandOptions, runConsole } from './console.js';
import { getProjectLinkManifestPath } from './project-link-manifest.js';

/** A value that must never reach the result. */
const SECRET = 'vcli_access-token';
const directories: string[] = [];
const manifest = {
    ...legacyManifest,
    console: { appOrigin: 'https://console.vendure.io', apiOrigin: 'https://api.vendure.io' },
};
beforeEach(() => {
    // Commands that read the CLI login from `process.env` read an empty one, never the real one.
    vi.stubEnv('VENDURE_CLI_CONFIG_DIR', createCliConfigDir(directories));
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    directories.splice(0).forEach(directory => fs.removeSync(directory));
});

/** A link as the host runs it when no person reads the output: nobody is asked, no raw errors. */
async function linkWithoutPerson(
    options: ConsoleCommandOptions,
    dependencies: Partial<ConsoleCommandDependencies> = {},
) {
    const messages: string[] = [];
    const report = (message: string) => messages.push(message);
    const reporter: ConsoleReporter = {
        error: report,
        info: report,
        success: report,
        warn: report,
        url: report,
    };
    const run = await runConsole('link', options, {
        env: { VENDURE_CLI_CONFIG_DIR: createCliConfigDir(directories) },
        reporter,
        outputMode: 'json',
        ...dependencies,
    });
    return { ...run, messages: messages.join('\n') };
}

describe('structured Console linking', () => {
    it('returns incomplete without signing in, opening a browser, prompting or calling Console', async () => {
        const root = createVendureProject(directories, 'console-result-');
        const fetch = vi.fn();
        const openUrl = vi.fn();
        const prompt = vi.fn();
        const select = vi.fn();
        const { exitCode, result } = await linkWithoutPerson(
            { dir: root },
            { fetch, openUrl, prompt, select },
        );
        expect(exitCode).toBe(1);
        for (const fn of [fetch, openUrl, prompt, select]) expect(fn).not.toHaveBeenCalled();
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
        expect(result).toMatchObject({ schemaVersion: 1, operation: 'console.link', outcome: 'incomplete' });
        expect(result.needs).toEqual([
            expect.objectContaining({
                kind: 'input',
                field: 'token',
                secret: true,
                fix: expect.objectContaining({ path: ['auth', 'login'], input: { json: true } }),
            }),
        ]);
        expect(result.nextSteps.join(' ')).toContain('vendure auth login --json');
        expect(result.nextSteps.join(' ')).toContain('vendure console link');
    });

    it('gives a hook immutable options and keeps the decisions of the CLI apart', async () => {
        const root = linkedProject();
        let received: ConsoleLinkContext | undefined;
        vi.stubEnv('VENDURE_CONSOLE_APP_URL', '');
        vi.stubEnv('VENDURE_CONSOLE_API_URL', '');
        const { exitCode, result } = await linkWithoutPerson(
            { dir: root },
            {
                hooks: [
                    {
                        pluginId: '@example/setup',
                        requiresSession: true,
                        hook: async context => {
                            received = context;
                            expect(Object.isFrozen(context.options)).toBe(true);
                            expect(context.options.dir).toBe(root);
                            expect(context.session).toBeUndefined();
                            expect(context.force).toBe(false);
                            expect(context.outputMode).toBe('json');
                            expect(context.isNonInteractive).toBe(true);
                            await expect(context.confirm('Replace?')).rejects.toThrow('non-interactive');
                            context.reporter.info('Setup progress');
                            context.contributeResult({
                                outcome: 'incomplete',
                                data: { credential: 'missing' },
                                missingInputs: [{ input: 'consoleSession', command: 'vendure console link' }],
                                nextSteps: ['Sign in interactively on this machine.'],
                            });
                        },
                    },
                ],
            },
        );
        expect(received).toBeDefined();
        expect(exitCode).toBe(1);
        expect(JSON.stringify(result)).not.toContain(SECRET);
        expect(result).toMatchObject({
            schemaVersion: 1,
            operation: 'console.link',
            outcome: 'incomplete',
            data: {
                link: { outcome: 'repaired' },
                plugins: { '@example/setup': { credential: 'missing' } },
            },
            needs: [
                {
                    kind: 'input',
                    field: 'consoleSession',
                    description: 'consoleSession: run vendure console link',
                },
            ],
            nextSteps: ['Sign in interactively on this machine.'],
        });
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('reports reused links and hides raw hook errors', async () => {
        const root = linkedProject();
        const run = await linkWithoutPerson(
            { dir: root },
            {
                hooks: [
                    {
                        pluginId: '@example/setup',
                        hook: async () => {
                            throw new Error(SECRET);
                        },
                    },
                ],
            },
        );
        expect(run.exitCode).toBe(1);
        expect(JSON.stringify(run.result)).not.toContain(SECRET);
        expect(run.messages).not.toContain(SECRET);
        expect(run.result).toMatchObject({ outcome: 'failed', data: { link: { outcome: 'repaired' } } });
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('reuses an approved link without requiring an unused session', async () => {
        const root = linkedProject();
        const { exitCode, result } = await linkWithoutPerson({ dir: root }, { env: {} });
        expect(exitCode).toBe(0);
        expect(result).toMatchObject({ outcome: 'repaired', needs: [], nextSteps: [] });
    });

    it('does not replace an approved link or run hooks with the consent but no login, without a person', async () => {
        const root = linkedProject();
        const fetch = vi.fn();
        const hook = vi.fn();
        const { exitCode, result } = await linkWithoutPerson(
            { dir: root, force: true },
            { fetch, hooks: [{ pluginId: '@example/setup', hook }] },
        );
        expect(exitCode).toBe(1);
        expect(fetch).not.toHaveBeenCalled();
        expect(hook).not.toHaveBeenCalled();
        expect(result).toMatchObject({ outcome: 'incomplete' });
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('combines two configured hooks in one result', async () => {
        const root = linkedProject();
        const { exitCode, result } = await linkWithoutPerson(
            { dir: root },
            {
                hooks: ['@example/credential', '@example/registry'].map(pluginId => ({
                    pluginId,
                    hook: async (context: ConsoleLinkContext) => {
                        expect(context.outputMode).toBe('json');
                        context.contributeResult({ outcome: 'configured', data: { status: 'configured' } });
                    },
                })),
            },
        );
        expect(exitCode).toBe(0);
        expect(result).toMatchObject({
            outcome: 'repaired',
            data: {
                plugins: {
                    '@example/credential': { status: 'configured' },
                    '@example/registry': { status: 'configured' },
                },
            },
        });
    });

    // The docs MCP guidance is for a person at a terminal only.
    it('keeps the docs MCP guidance out of a link without a person', async () => {
        const root = createVendureProject(directories, 'console-result-');
        const env = { VENDURE_CLI_CONFIG_DIR: createCliConfigDir(directories) };
        storeLogin(env, 'https://api.vendure.io');
        const { exitCode, result, messages } = await linkWithoutPerson(
            { dir: root },
            { env, fetch: fakeConsole().fetch },
        );
        expect(exitCode).toBe(0);
        expect(result).toEqual({
            schemaVersion: 1,
            operation: 'console.link',
            outcome: 'linked',
            data: {
                link: { outcome: 'linked', manifestPath: getProjectLinkManifestPath(root) },
                plugins: {},
            },
            needs: [],
            nextSteps: [],
        });
        expect(messages).toContain('Linked Storefront to Acme');
        expect(messages).not.toContain('https://docs.vendure.io/mcp');
    });

    it('does not report success when a hook stops setup with exit code zero', async () => {
        const root = linkedProject();
        const { exitCode, result } = await linkWithoutPerson(
            { dir: root },
            {
                hooks: [
                    {
                        pluginId: '@example/setup',
                        hook: () => {
                            throw new CliCommandExit(0);
                        },
                    },
                ],
            },
        );
        expect(exitCode).toBe(1);
        expect(result).toMatchObject({ outcome: 'failed' });
    });
});

function linkedProject() {
    const root = createVendureProject(directories, 'console-result-');
    fs.outputJsonSync(getProjectLinkManifestPath(root), manifest);
    return root;
}
