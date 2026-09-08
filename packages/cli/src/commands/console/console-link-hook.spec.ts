import fs from 'fs-extra';
import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CliCommandExit } from '../../shared/cli-command-exit';
import { CLI_PLUGIN_EXTENSION_POINTS, defineCliPlugin } from '../../shared/cli-plugin';
import { CommandRegistry } from '../../shared/command-registry-store';
import { builtinCommandDefs } from '../builtins';

import { ConsoleCommandDependencies, consoleCommand } from './console';
import { ConsoleLinkContext, ConsoleLinkHook, ConsoleLinkHookRegistration } from './console-link-hook';
import { ConsoleReporter } from './console-reporter';
import { LINK_ID, POLLING_SECRET, manifest } from './console.fixtures';
import { getProjectLinkManifestPath } from './project-link-manifest';

// Two plugins, so the tests that care about order can name which is which.
const FIRST_PLUGIN = '@example/first-cli-plugin';
const SECOND_PLUGIN = '@example/second-cli-plugin';

const temporaryDirectories: string[] = [];
let server: Server | undefined;

afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
        await new Promise<void>((resolve, reject) =>
            server?.close(error => (error ? reject(error) : resolve())),
        );
        server = undefined;
    }
    for (const directory of temporaryDirectories.splice(0)) {
        fs.removeSync(directory);
    }
});

describe('console link hooks', () => {
    it('runs a plugin hook once after a link, with what the command already resolved', async () => {
        const contexts: ConsoleLinkContext[] = [];
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async received => {
                contexts.push(received);
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry);

        expect(test.exitCode).toBe(0);
        // The OSS protocol ran exactly once: one create, one poll.
        expect(test.requestPaths).toEqual(['/v1/project-links', `/v1/project-links/${LINK_ID}/poll`]);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);

        expect(contexts).toHaveLength(1);
        const context = contexts[0];
        expect(context.projectRoot).toBe(root);
        expect(context.manifestPath).toBe(getProjectLinkManifestPath(root));
        expect(context.manifest).toEqual(manifest);
        expect(context.force).toBe(false);
        expect(context.outcome).toBe('linked');
        expect(context.isNonInteractive).toBe(true);
        // A loopback Console is not an official origin, so a hook holding
        // credentials is told plainly that it is not talking to Vendure.
        expect(context.endpoints.official).toBeUndefined();
        expect(context.endpoints.apiUrl).toBe(test.apiUrl);
    });

    it('links the same way when no plugin registers a hook', async () => {
        const root = vendureProject();
        const test = await runLink(root, registryWith());

        expect(test.exitCode).toBe(0);
        expect(test.requestPaths).toEqual(['/v1/project-links', `/v1/project-links/${LINK_ID}/poll`]);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('runs hooks in plugin order and stops at the first failure', async () => {
        const trace: string[] = [];
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async () => {
                trace.push(FIRST_PLUGIN);
                throw new Error('Console rejected the credential request.');
            }),
            plugin(SECOND_PLUGIN, async () => {
                trace.push(SECOND_PLUGIN);
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry);

        expect(trace).toEqual([FIRST_PLUGIN]);
        expect(test.exitCode).toBe(1);
        // The link is not rolled back, and the report says so rather than
        // leaving the reader to guess what survived.
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
        const output = test.messages.join('\n');
        expect(output).toContain(`The ${FIRST_PLUGIN} plugin failed after linking`);
        expect(output).toContain('Console rejected the credential request.');
        expect(output).toContain('The link succeeded');
        // Repairing a credential store must not be sold as another link, which
        // would create a second Project Link in Console.
        expect(output).not.toContain('vendure console link again');
    });

    it('keeps the exit code at 0 when a hook reports that it could not finish', async () => {
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async context => {
                // A hook that cannot finish says so through the reporter and
                // returns, rather than throwing. Naming what to run next is the
                // plugin's own business, so this is the plugin's own command.
                context.reporter.warn('Nothing to set up from here yet. Run "example-setup init".');
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry);

        // Linking is what the command was asked to do, and it did it.
        expect(test.exitCode).toBe(0);
        expect(test.messages.join('\n')).toContain('example-setup init');
    });

    it('does not claim nothing changed when interrupted after the manifest is written', async () => {
        const abort = new AbortController();
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async () => {
                abort.abort();
                throw new Error('aborted while issuing a credential');
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry, { signal: abort.signal });

        expect(test.exitCode).toBe(130);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(true);
        const output = test.messages.join('\n');
        expect(output).toContain('The link succeeded');
        expect(output).not.toContain('No Project Link Manifest was changed');
    });

    it.each(['status', 'unlink', 'nonsense'])('does not run hooks for %s', async action => {
        const hook = vi.fn<ConsoleLinkHook>(async () => undefined);
        const registry = registryWith(plugin(FIRST_PLUGIN, hook));
        const root = vendureProject();

        await consoleCommand(action, {}, { ...offlineDependencies(root), hooks: consoleLinkHooks(registry) });

        expect(hook).not.toHaveBeenCalled();
    });

    it('does not run hooks when a link is refused before any request', async () => {
        const hook = vi.fn<ConsoleLinkHook>(async () => undefined);
        const registry = registryWith(plugin(FIRST_PLUGIN, hook));
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const root = vendureProject();

        const exitCode = await consoleCommand(
            'link',
            {},
            {
                ...offlineDependencies(root),
                // A custom remote Console with no approval, so the command
                // stops before it creates anything.
                env: {
                    VENDURE_CLI_NON_INTERACTIVE: 'true',
                    VENDURE_CONSOLE_LINK_URL: 'https://console.staging.example.com',
                    VENDURE_CONSOLE_LINK_API_URL: 'https://api.staging.example.com',
                },
                fetch: fetchMock,
                hooks: consoleLinkHooks(registry),
            },
        );

        expect(exitCode).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(hook).not.toHaveBeenCalled();
    });

    it('registers no hook for a plugin the registry rejected', () => {
        const registry = registryWith();
        const rejected = defineCliPlugin({
            id: FIRST_PLUGIN,
            // `console` is already a built-in and this does not set
            // `replaces`, so the whole plugin is refused.
            commands: [{ name: 'console', description: 'Shadowed console', action: async () => 0 }],
            afterConsoleLink: async () => undefined,
        });

        expect(() => registry.applyPlugin(rejected)).toThrow();
        expect(registry.getPluginExtensions('afterConsoleLink')).toEqual([]);
    });

    it('lets one plugin both extend the console command and register a hook', async () => {
        const trace: string[] = [];
        const registry = registryWith();
        registry.applyPlugin(
            defineCliPlugin({
                id: FIRST_PLUGIN,
                commands: [],
                extendCommands: [
                    {
                        command: 'console',
                        decorate:
                            ({ next }) =>
                            async (...args) => {
                                trace.push('decorator');
                                return next(...args);
                            },
                    },
                ],
                afterConsoleLink: async () => {
                    trace.push('hook');
                },
            }),
        );

        expect(registry.getPluginExtensions('afterConsoleLink').map(entry => entry.pluginId)).toEqual([
            FIRST_PLUGIN,
        ]);
        const root = vendureProject();
        const test = await runLink(root, registry);

        expect(test.exitCode).toBe(0);
        expect(trace).toEqual(['hook']);
    });

    it('names afterConsoleLink as a supported extension point at runtime', () => {
        // A plugin resolving an older CLI gets `undefined` here, which is how
        // it tells that its hook would be accepted and then never run.
        expect(CLI_PLUGIN_EXTENSION_POINTS).toEqual([
            'commands',
            'rootOptions',
            'subcommands',
            'extendCommands',
            'afterConsoleLink',
        ]);
        expect(Object.isFrozen(CLI_PLUGIN_EXTENSION_POINTS)).toBe(true);
    });

    it('runs the hooks again for a project that is already linked, without a second Project Link', async () => {
        const contexts: ConsoleLinkContext[] = [];
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async received => {
                contexts.push(received);
            }),
        );
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const fetchMock = vi.fn() as unknown as typeof fetch;

        const exitCode = await consoleCommand(
            'link',
            {},
            { ...offlineDependencies(root), fetch: fetchMock, hooks: consoleLinkHooks(registry) },
        );

        expect(exitCode).toBe(0);
        // Repair is local. Nothing is asked of Console, so no second Project
        // Link is created and the first is not abandoned.
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
        expect(contexts).toHaveLength(1);
        expect(contexts[0].outcome).toBe('repaired');
        expect(contexts[0].manifest).toEqual(manifest);
        expect(contexts[0].manifestPath).toBe(getProjectLinkManifestPath(root));
    });

    it('reports a repair that did not finish without claiming the link changed', async () => {
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async () => {
                throw new Error('Console rejected the credential request.');
            }),
        );
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const messages: string[] = [];

        const exitCode = await consoleCommand(
            'link',
            {},
            { ...offlineDependencies(root, messages), hooks: consoleLinkHooks(registry) },
        );

        expect(exitCode).toBe(1);
        const output = messages.join('\n');
        expect(output).toContain('was not changed');
        expect(output).not.toContain('The link succeeded');
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('gives each hook its own context, so one cannot decide what the next reads', async () => {
        const seen: Array<{ official: string | undefined; projectName: string }> = [];
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async context => {
                // `official` is the fact a hook holding a credential checks
                // before it sends anything, so the plugin listed first must not
                // be able to answer it for the plugin listed second.
                context.endpoints.official = 'production';
                context.manifest.project.name = 'Tampered';
            }),
            plugin(SECOND_PLUGIN, async context => {
                seen.push({
                    official: context.endpoints.official,
                    projectName: context.manifest.project.name,
                });
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry);

        expect(test.exitCode).toBe(0);
        expect(seen).toEqual([{ official: undefined, projectName: manifest.project.name }]);
    });

    it('refuses a hook confirmation when there is nobody to answer it', async () => {
        let refusal: string | undefined;
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async context => {
                // The hook ignored `isNonInteractive`. Prompting here would
                // write a question into a pipe and then wait for an answer.
                await context.confirm('Replace the stored credential?').catch((error: Error) => {
                    refusal = error.message;
                    throw error;
                });
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry);

        expect(test.exitCode).toBe(1);
        expect(refusal).toContain('non-interactive');
        expect(test.messages.join('\n')).toContain('context.isNonInteractive');
    });

    // Zero as well as non-zero: `exitCliCommand(0)` is how every built-in
    // prompt reports a cancellation, so a hook driving one unwinds through here
    // with a code that means "stopped", not "nothing happened".
    it.each([
        { exitCode: 0, level: 'warn' as const },
        { exitCode: 2, level: 'error' as const },
    ])('preserves exit code $exitCode and reports at $level level', async ({ exitCode, level }) => {
        const trace: string[] = [];
        const messages: string[] = [];
        const reports: Array<{ level: keyof ConsoleReporter; message: string }> = [];
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async () => {
                trace.push(FIRST_PLUGIN);
                throw new CliCommandExit(exitCode);
            }),
            plugin(SECOND_PLUGIN, async () => {
                trace.push(SECOND_PLUGIN);
            }),
        );
        const root = vendureProject();

        await expect(
            runLink(root, registry, { reporter: recordingReporter(messages, reports) }),
        ).rejects.toMatchObject({ exitCode });
        // The hooks after it did not run, and the reader is told so rather than
        // being left with an exit code and a success message.
        expect(trace).toEqual([FIRST_PLUGIN]);
        const output = messages.join('\n');
        expect(output).toContain(`The ${FIRST_PLUGIN} plugin stopped the run after linking`);
        expect(reports).toContainEqual({
            level,
            message: `The ${FIRST_PLUGIN} plugin stopped the run after linking.`,
        });
        expect(output).toContain('The link succeeded');
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('snapshots non-interactive mode once for a hook context and its confirm function', async () => {
        const isNonInteractive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
        const registry = registryWith(
            plugin(FIRST_PLUGIN, async context => {
                expect(context.isNonInteractive).toBe(true);
                await expect(context.confirm('Continue?')).rejects.toThrow('non-interactive');
            }),
        );

        const test = await runLink(vendureProject(), registry, { isNonInteractive });

        expect(test.exitCode).toBe(0);
        expect(isNonInteractive).toHaveBeenCalledTimes(1);
    });

    it('preserves an explicit session request through registration', () => {
        const hook = vi.fn<ConsoleLinkHook>(async () => undefined);
        const registration = { hook, requiresSession: true } as const;
        const registry = registryWith(plugin(FIRST_PLUGIN, registration));

        expect(registry.getPluginExtensions('afterConsoleLink')).toEqual([
            { pluginId: FIRST_PLUGIN, extension: registration },
        ]);
        expect(consoleLinkHooks(registry)).toEqual([{ pluginId: FIRST_PLUGIN, hook, requiresSession: true }]);
    });

    it('rejects an invalid afterConsoleLink registration', () => {
        expect(() =>
            defineCliPlugin({
                id: FIRST_PLUGIN,
                commands: [],
                afterConsoleLink: { requiresSession: true } as unknown as ConsoleLinkHookRegistration,
            }),
        ).toThrow('afterConsoleLink must be a function or a session-requesting hook');
    });
});

function plugin(id: string, afterConsoleLink: ConsoleLinkHookRegistration) {
    return defineCliPlugin({ id, commands: [], afterConsoleLink });
}

/**
 * A registry holding the real built-in commands, so `console` is registered the
 * way the host registers it and a plugin meets the same collision rules.
 */
function registryWith(...plugins: Array<ReturnType<typeof plugin>>): CommandRegistry {
    const registry = new CommandRegistry();
    registry.registerAll(builtinCommandDefs);
    for (const entry of plugins) {
        registry.applyPlugin(entry);
    }
    return registry;
}

/**
 * Runs `vendure console link` against a local Console that completes the
 * protocol, with the hooks the registry collected.
 */
async function runLink(
    root: string,
    registry: CommandRegistry,
    overrides: Partial<ConsoleCommandDependencies> = {},
): Promise<{ exitCode: number; messages: string[]; requestPaths: string[]; apiUrl: string }> {
    const requestPaths: string[] = [];
    server = createServer((request, response) => {
        requestPaths.push(request.url ?? '');
        respondAsConsole(request, response);
    });
    await new Promise<void>(resolve => server?.listen(0, '127.0.0.1', resolve));
    const apiUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const messages: string[] = [];
    const exitCode = await consoleCommand(
        'link',
        {},
        {
            ...offlineDependencies(root, messages),
            env: {
                VENDURE_CLI_NON_INTERACTIVE: 'true',
                VENDURE_CONSOLE_LINK_URL: 'http://localhost:3000',
                VENDURE_CONSOLE_LINK_API_URL: apiUrl,
            },
            fetch: globalThis.fetch,
            hooks: consoleLinkHooks(registry),
            ...overrides,
        },
    );

    return { exitCode, messages, requestPaths, apiUrl };
}

function recordingReporter(
    messages: string[],
    reports?: Array<{ level: keyof ConsoleReporter; message: string }>,
): ConsoleReporter {
    return {
        error: message => record('error', message),
        info: message => record('info', message),
        success: message => record('success', message),
        warn: message => record('warn', message),
        url: value => record('url', value),
    };

    function record(level: keyof ConsoleReporter, message: string): void {
        messages.push(message);
        reports?.push({ level, message });
    }
}

function consoleLinkHooks(registry: CommandRegistry) {
    return registry
        .getPluginExtensions<ConsoleLinkHookRegistration>('afterConsoleLink')
        .map(({ pluginId, extension }) =>
            typeof extension === 'function'
                ? { pluginId, hook: extension, requiresSession: false }
                : { pluginId, hook: extension.hook, requiresSession: true },
        );
}

function offlineDependencies(root: string, messages: string[] = []): Partial<ConsoleCommandDependencies> {
    const reporter = recordingReporter(messages);
    return {
        cwd: root,
        env: { VENDURE_CLI_NON_INTERACTIVE: 'true' },
        fetch: vi.fn() as unknown as typeof fetch,
        hooks: [],
        isNonInteractive: () => true,
        openUrl: () => Promise.resolve(),
        prompt: () => Promise.resolve(true),
        reporter,
        sleep: () => Promise.resolve(),
    };
}

function respondAsConsole(request: IncomingMessage, response: ServerResponse): void {
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/v1/project-links') {
        response.end(
            JSON.stringify({
                id: LINK_ID,
                state: 'pending',
                protocolVersion: 1,
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                pollingSecret: POLLING_SECRET,
                verificationPath: `/?link=${LINK_ID}`,
            }),
        );
        return;
    }
    response.end(
        JSON.stringify({
            state: 'approved',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            manifest,
        }),
    );
}

function vendureProject(): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-hook-')));
    temporaryDirectories.push(root);
    fs.writeJsonSync(path.join(root, 'package.json'), {
        dependencies: { '@vendure/core': '3.7.2' },
    });
    return root;
}
