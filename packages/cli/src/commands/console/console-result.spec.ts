import fs from 'fs-extra';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defineCliPlugin, type ConsoleLinkContext } from '../../index';
import { runCli } from '../../shared/__tests__/run-cli';
import { CliCommandExit } from '../../shared/cli-command-exit';
import { CommandRegistry } from '../../shared/command-registry-store';

import { consoleCommandDef } from './command';
import { consoleCommand } from './console';
import {
    createCliConfigDir,
    createVendureProject,
    fakeConsole,
    manifest as legacyManifest,
    storeLogin,
} from './console.fixtures';
import { getProjectLinkManifestPath } from './project-link-manifest';

/** A value that must never reach stdout. */
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

describe('EE-388 structured Console linking', () => {
    it('returns incomplete without signing in, opening a browser, prompting or calling Console', async () => {
        const root = createVendureProject(directories, 'console-result-');
        const fetch = vi.fn();
        const openUrl = vi.fn();
        const prompt = vi.fn();
        const select = vi.fn();
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const code = await consoleCommand(
            'link',
            { project: root, json: true, nonInteractive: true },
            {
                env: {},
                fetch,
                openUrl,
                prompt,
                select,
                isNonInteractive: () => false,
            },
        );
        expect(code).toBe(1);
        for (const fn of [fetch, openUrl, prompt, select]) expect(fn).not.toHaveBeenCalled();
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
        expect(stdout).toHaveBeenCalledTimes(1);
        const result = JSON.parse(String(stdout.mock.calls[0][0]));
        expect(result).toMatchObject({ schemaVersion: 1, operation: 'console.link', outcome: 'incomplete' });
        expect(result.missingInputs).toEqual([
            { input: 'projectLinkApproval', command: 'vendure console link' },
        ]);
        expect(result.nextSteps.join(' ')).toContain('vendure console link');
    });

    it.each([
        { yes: false, rotate: true },
        { yes: true, rotate: false },
    ])(
        'passes immutable plugin options through the public command and keeps Core decisions separate: %s',
        async ({ yes, rotate }) => {
            const root = linkedProject();
            let received: ConsoleLinkContext | undefined;
            const registry = new CommandRegistry();
            registry.register(consoleCommandDef);
            registry.applyPlugin(
                defineCliPlugin({
                    id: '@example/setup',
                    commands: [],
                    extendCommands: [
                        {
                            command: 'console',
                            options: [
                                {
                                    long: '--rotate-credential',
                                    description: 'Replace a development credential',
                                },
                                { long: '--setup-token <token>', description: 'Plugin input' },
                            ],
                            decorate:
                                ({ next }) =>
                                (...args) =>
                                    next(...args),
                        },
                    ],
                    afterConsoleLink: {
                        requiresSession: true,
                        hook: async context => {
                            received = context;
                            expect(Object.isFrozen(context.options)).toBe(true);
                            expect(context.options.rotateCredential === true).toBe(rotate);
                            expect(context.options.setupToken).toBe(SECRET);
                            expect(context.session).toBeUndefined();
                            expect(context.options.yes === true).toBe(yes);
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
                }),
            );
            vi.stubEnv('VENDURE_CONSOLE_APP_URL', '');
            vi.stubEnv('VENDURE_CONSOLE_API_URL', '');
            const result = await runCli(
                registry.getCommandTree(),
                [],
                [
                    'console',
                    'link',
                    '--project',
                    root,
                    '--json',
                    '--non-interactive',
                    '--setup-token',
                    SECRET,
                    ...(rotate ? ['--rotate-credential'] : []),
                    ...(yes ? ['--yes'] : []),
                ],
                registry.getPluginExtensions.bind(registry),
                () => root,
            );
            expect(received).toBeDefined();
            expect(result.exitCode).toBe(1);
            expect(result.stdout.trim().split('\n')).toHaveLength(1);
            expect(result.stdout).not.toContain(SECRET);
            expect(JSON.parse(result.stdout)).toMatchObject({
                schemaVersion: 1,
                operation: 'console.link',
                outcome: 'incomplete',
                data: {
                    link: { outcome: 'repaired' },
                    plugins: { '@example/setup': { credential: 'missing' } },
                },
                missingInputs: [{ input: 'consoleSession', command: 'vendure console link' }],
                nextSteps: ['Sign in interactively on this machine.'],
            });
            expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
        },
    );

    it('reports reused links and hides raw hook errors and command options', async () => {
        const root = linkedProject();
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const code = await consoleCommand(
            'link',
            { project: root, json: true, nonInteractive: true },
            {
                env: {},
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
        expect(code).toBe(1);
        expect(stdout).toHaveBeenCalledTimes(1);
        const output = String(stdout.mock.calls[0][0]);
        expect(output).not.toContain(SECRET);
        expect(JSON.parse(output)).toMatchObject({
            outcome: 'failed',
            data: { link: { outcome: 'repaired' } },
        });
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('reuses an approved link without requiring an unused session', async () => {
        const root = linkedProject();
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const code = await consoleCommand(
            'link',
            { project: root, json: true, nonInteractive: true },
            { env: {} },
        );
        expect(code).toBe(0);
        expect(JSON.parse(String(stdout.mock.calls[0][0]))).toMatchObject({
            outcome: 'repaired',
            missingInputs: [],
            nextSteps: [],
        });
    });

    it('does not replace an approved link or run hooks with --force --yes in explicit non-interactive mode', async () => {
        const root = linkedProject();
        const fetch = vi.fn();
        const hook = vi.fn();
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const code = await consoleCommand(
            'link',
            { project: root, json: true, nonInteractive: true, force: true, yes: true },
            {
                env: {},
                fetch,
                hooks: [{ pluginId: '@example/setup', hook }],
            },
        );
        expect(code).toBe(1);
        expect(fetch).not.toHaveBeenCalled();
        expect(hook).not.toHaveBeenCalled();
        expect(JSON.parse(String(stdout.mock.calls[0][0]))).toMatchObject({ outcome: 'incomplete' });
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('combines two configured hooks and command decorators in one result', async () => {
        const root = linkedProject();
        const registry = new CommandRegistry();
        registry.register(consoleCommandDef);
        for (const id of ['@example/credential', '@example/registry']) {
            registry.applyPlugin(
                defineCliPlugin({
                    id,
                    commands: [],
                    extendCommands: [
                        {
                            command: 'console',
                            options:
                                id === '@example/credential'
                                    ? [
                                          {
                                              long: '--setup-state <state>',
                                              description: 'Plugin default',
                                              defaultValue: { rotate: [false] },
                                          },
                                      ]
                                    : [],
                            decorate:
                                ({ next }) =>
                                (...args) =>
                                    next(...args),
                        },
                    ],
                    afterConsoleLink: async context => {
                        expect(context.outputMode).toBe('json');
                        const option = context.options.setupState as { rotate: boolean[] };
                        expect(Object.isFrozen(option)).toBe(true);
                        expect(Object.isFrozen(option.rotate)).toBe(true);
                        expect(() => option.rotate.push(true)).toThrow(TypeError);
                        expect(option.rotate).toEqual([false]);
                        context.contributeResult({ outcome: 'configured', data: { status: 'configured' } });
                    },
                }),
            );
        }
        const output = await runCli(
            registry.getCommandTree(),
            [],
            ['console', 'link', '--project', root, '--json', '--non-interactive'],
            registry.getPluginExtensions.bind(registry),
            () => root,
        );
        expect(output.exitCode).toBe(0);
        expect(JSON.parse(output.stdout)).toMatchObject({
            outcome: 'repaired',
            data: {
                plugins: {
                    '@example/credential': { status: 'configured' },
                    '@example/registry': { status: 'configured' },
                },
            },
        });
    });

    it('keeps terminal prompts out of JSON stdout even without --non-interactive', async () => {
        const root = linkedProject();
        const prompt = vi.fn();
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const code = await consoleCommand(
            'link',
            { project: root, json: true },
            {
                env: {},
                prompt,
                isNonInteractive: () => false,
                hooks: [
                    {
                        pluginId: '@example/setup',
                        hook: async context => {
                            expect(context.isNonInteractive).toBe(true);
                            await expect(context.confirm('Replace?')).rejects.toThrow('non-interactive');
                        },
                    },
                ],
            },
        );
        expect(code).toBe(0);
        expect(prompt).not.toHaveBeenCalled();
        expect(stdout).toHaveBeenCalledTimes(1);
    });

    // PDEV-478: the docs MCP guidance is terminal output only. The JSON result keeps its shape.
    it('keeps the docs MCP guidance out of a JSON link result and its stderr', async () => {
        const root = createVendureProject(directories, 'console-result-');
        const env = { VENDURE_CLI_CONFIG_DIR: createCliConfigDir(directories) };
        storeLogin(env, 'https://api.vendure.io');
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
        const code = await consoleCommand(
            'link',
            { project: root, json: true },
            { env, fetch: fakeConsole().fetch },
        );
        expect(code).toBe(0);
        expect(stdout).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual({
            schemaVersion: 1,
            operation: 'console.link',
            outcome: 'linked',
            data: {
                link: { outcome: 'linked', manifestPath: getProjectLinkManifestPath(root) },
                plugins: {},
            },
            missingInputs: [],
            nextSteps: [],
        });
        expect(stderr.mock.calls.join('\n')).toContain('Linked Storefront to Acme');
        expect(stderr.mock.calls.join('\n')).not.toContain('https://docs.vendure.io/mcp');
    });

    it('does not report success when a hook stops JSON setup with exit code zero', async () => {
        const root = linkedProject();
        const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
        const code = await consoleCommand(
            'link',
            { project: root, json: true, nonInteractive: true },
            {
                env: {},
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
        expect(code).toBe(1);
        expect(JSON.parse(String(stdout.mock.calls[0][0]))).toMatchObject({ outcome: 'failed' });
    });
});

function linkedProject() {
    const root = createVendureProject(directories, 'console-result-');
    fs.outputJsonSync(getProjectLinkManifestPath(root), manifest);
    return root;
}
