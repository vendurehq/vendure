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

import { ConsoleCommandDependencies, ConsoleReporter, consoleCommand } from './console';
import { ConsoleLinkContext, ConsoleLinkHook } from './console-link-hook';
import { LINK_ID, POLLING_SECRET, manifest } from './console.fixtures';
import { getProjectLinkManifestPath } from './project-link-manifest';

const PLATFORM_ID = '@vendure-platform/cli';
const CLOUD_ID = '@vendure/cloud';

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
            plugin(PLATFORM_ID, async received => {
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
        expect(context.signal.aborted).toBe(false);
        // A loopback Console is not the production pair, so a hook holding
        // credentials is told plainly that it is not talking to Vendure.
        expect(context.endpoints.areDefault).toBe(false);
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
            plugin(PLATFORM_ID, async () => {
                trace.push(PLATFORM_ID);
                throw new Error('Console rejected the credential request.');
            }),
            plugin(CLOUD_ID, async () => {
                trace.push(CLOUD_ID);
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry);

        expect(trace).toEqual([PLATFORM_ID]);
        expect(test.exitCode).toBe(1);
        // The link is not rolled back, and the report says so rather than
        // leaving the reader to guess what survived.
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
        const output = test.messages.join('\n');
        expect(output).toContain(`The ${PLATFORM_ID} plugin failed after linking`);
        expect(output).toContain('Console rejected the credential request.');
        expect(output).toContain('The link succeeded');
        // Repairing a credential store must not be sold as another link, which
        // would mint a second Project Link in Console.
        expect(output).not.toContain('vendure console link again');
    });

    it('keeps the exit code at 0 when a hook reports that it could not finish', async () => {
        const registry = registryWith(
            plugin(PLATFORM_ID, async context => {
                context.reporter.warn('No Console session on this machine. Run "vendure platform repair".');
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry);

        // Linking is what the command was asked to do, and it did it.
        expect(test.exitCode).toBe(0);
        expect(test.messages.join('\n')).toContain('vendure platform repair');
    });

    it('does not claim nothing changed when interrupted after the manifest is written', async () => {
        const abort = new AbortController();
        const registry = registryWith(
            plugin(PLATFORM_ID, async () => {
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

    it('does not run hooks for status, unlink or an unknown action', async () => {
        const hook = vi.fn<ConsoleLinkHook>(async () => undefined);
        const registry = registryWith(plugin(PLATFORM_ID, hook));
        const root = vendureProject();
        const hooks = registry.getConsoleLinkHooks();

        for (const action of ['status', 'unlink', 'nonsense']) {
            await consoleCommand(action, {}, { ...offlineDependencies(root), hooks });
        }

        expect(hook).not.toHaveBeenCalled();
    });

    it('does not run hooks when a link is refused before any request', async () => {
        const hook = vi.fn<ConsoleLinkHook>(async () => undefined);
        const registry = registryWith(plugin(PLATFORM_ID, hook));
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
                hooks: registry.getConsoleLinkHooks(),
            },
        );

        expect(exitCode).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(hook).not.toHaveBeenCalled();
    });

    it('registers no hook for a plugin the registry rejected', () => {
        const registry = registryWith();
        const rejected = defineCliPlugin({
            id: PLATFORM_ID,
            // `console` is already a built-in and this does not set
            // `replaces`, so the whole plugin is refused.
            commands: [{ name: 'console', description: 'Shadowed console', action: async () => 0 }],
            afterConsoleLink: async () => undefined,
        });

        expect(() => registry.applyPlugin(rejected)).toThrow();
        expect(registry.getConsoleLinkHooks()).toEqual([]);
    });

    it('lets one plugin both extend the console command and register a hook', async () => {
        const trace: string[] = [];
        const registry = registryWith();
        registry.applyPlugin(
            defineCliPlugin({
                id: PLATFORM_ID,
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

        expect(registry.getConsoleLinkHooks().map(entry => entry.pluginId)).toEqual([PLATFORM_ID]);
        const root = vendureProject();
        const test = await runLink(root, registry);

        expect(test.exitCode).toBe(0);
        expect(trace).toEqual(['hook']);
    });

    it('names afterConsoleLink as a supported extension point at runtime', () => {
        // A plugin resolving an older CLI gets `undefined` here, which is how
        // it tells that its hook would be accepted and then never run.
        expect(CLI_PLUGIN_EXTENSION_POINTS).toContain('afterConsoleLink');
        expect(CLI_PLUGIN_EXTENSION_POINTS).toContain('extendCommands');
        expect(Object.isFrozen(CLI_PLUGIN_EXTENSION_POINTS)).toBe(true);
    });

    it('runs the hooks again for a project that is already linked, without a second Project Link', async () => {
        const contexts: ConsoleLinkContext[] = [];
        const registry = registryWith(
            plugin(PLATFORM_ID, async received => {
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
            { ...offlineDependencies(root), fetch: fetchMock, hooks: registry.getConsoleLinkHooks() },
        );

        expect(exitCode).toBe(0);
        // Repair is local. Nothing is asked of Console, so no second Project
        // Link is minted and the first is not abandoned.
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
        expect(contexts).toHaveLength(1);
        expect(contexts[0].outcome).toBe('repaired');
        expect(contexts[0].manifest).toEqual(manifest);
        expect(contexts[0].manifestPath).toBe(getProjectLinkManifestPath(root));
    });

    it('reports a repair that did not finish without claiming the link changed', async () => {
        const registry = registryWith(
            plugin(PLATFORM_ID, async () => {
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
            { ...offlineDependencies(root, messages), hooks: registry.getConsoleLinkHooks() },
        );

        expect(exitCode).toBe(1);
        const output = messages.join('\n');
        expect(output).toContain('was not changed');
        expect(output).not.toContain('The link succeeded');
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('gives each hook its own context, so one cannot decide what the next reads', async () => {
        const seen: Array<{ areDefault: boolean; projectName: string }> = [];
        const registry = registryWith(
            plugin(PLATFORM_ID, async context => {
                // `areDefault` is the fact a hook holding a credential checks
                // before it sends anything, so the plugin listed first must not
                // be able to answer it for the plugin listed second.
                context.endpoints.areDefault = true;
                context.manifest.project.name = 'Tampered';
            }),
            plugin(CLOUD_ID, async context => {
                seen.push({
                    areDefault: context.endpoints.areDefault,
                    projectName: context.manifest.project.name,
                });
            }),
        );
        const root = vendureProject();
        const test = await runLink(root, registry);

        expect(test.exitCode).toBe(0);
        expect(seen).toEqual([{ areDefault: false, projectName: manifest.project.name }]);
    });

    it('refuses a hook confirmation when there is nobody to answer it', async () => {
        let refusal: string | undefined;
        const registry = registryWith(
            plugin(PLATFORM_ID, async context => {
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

    it('lets the CLI host own an exit a hook asked for', async () => {
        const registry = registryWith(
            plugin(PLATFORM_ID, async () => {
                throw new CliCommandExit(2);
            }),
        );
        const root = vendureProject();

        await expect(runLink(root, registry)).rejects.toBeInstanceOf(CliCommandExit);
    });

    it('rejects a plugin whose afterConsoleLink is not a function', () => {
        expect(() =>
            defineCliPlugin({
                id: PLATFORM_ID,
                commands: [],
                afterConsoleLink: 'not a function' as unknown as ConsoleLinkHook,
            }),
        ).toThrow('afterConsoleLink must be a function');
    });
});

function plugin(id: string, afterConsoleLink: ConsoleLinkHook) {
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
            hooks: registry.getConsoleLinkHooks(),
            ...overrides,
        },
    );

    return { exitCode, messages, requestPaths, apiUrl };
}

function offlineDependencies(root: string, messages: string[] = []): Partial<ConsoleCommandDependencies> {
    const reporter: ConsoleReporter = {
        error: message => messages.push(message),
        info: message => messages.push(message),
        success: message => messages.push(message),
        warn: message => messages.push(message),
        url: value => messages.push(value),
    };
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
