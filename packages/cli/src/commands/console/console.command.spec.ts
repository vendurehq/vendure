import type { CommandContext, CommandNeed, ConsentNeed } from '@vendure/common/lib/command';
import fs from 'fs-extra';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Prompter } from '../../command-host/host.js';
import { testCommand } from '../../command-host/test-command.js';
import { setPluginExtensionAccessor } from '../../shared/plugin-extensions.js';

import { ConsoleLinkHook, ConsoleLinkHookRegistration } from './console-link-hook.js';
import { run as runLink } from './console-link.run.js';
import {
    consoleLinkDefinition,
    consoleStatusDefinition,
    consoleUnlinkDefinition,
} from './console.command.js';
import {
    createCliConfigDir,
    createVendureProject,
    fakeConsole,
    manifest,
    OTHER_PROJECT_ID,
    PROJECT_ID,
    projectList,
    storeLogin,
} from './console.fixtures.js';
import { getProjectLinkManifestPath } from './project-link-manifest.js';

const directories: string[] = [];

beforeEach(() => {
    // The command reads the CLI login and the Console from `process.env`: an empty login, and the
    // production Console.
    vi.stubEnv('VENDURE_CLI_CONFIG_DIR', createCliConfigDir(directories));
    vi.stubEnv('VENDURE_CONSOLE_APP_URL', '');
    vi.stubEnv('VENDURE_CONSOLE_API_URL', '');
    vi.stubEnv('VENDURE_CLOUD_TOKEN', '');
});

afterEach(() => {
    setPluginExtensionAccessor(undefined);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    directories.splice(0).forEach(directory => fs.removeSync(directory));
});

function project(linked: 'valid' | 'invalid' | 'none' = 'valid'): string {
    const root = createVendureProject(directories, 'console-command-');
    if (linked === 'valid') {
        fs.outputJsonSync(getProjectLinkManifestPath(root), manifest);
    } else if (linked === 'invalid') {
        fs.outputFileSync(getProjectLinkManifestPath(root), '{invalid');
    }
    return root;
}

function consentNeed(needs: unknown): ConsentNeed {
    expect(needs).toEqual([expect.objectContaining({ kind: 'consent' })]);
    return (needs as ConsentNeed[])[0];
}

describe('vendure console unlink', () => {
    it('asks for the removeLink consent, and removes the manifest once it is given', async () => {
        const root = project();

        const asked = await testCommand(consoleUnlinkDefinition, { dir: root });
        expect(asked.envelope.status).toBe('incomplete');
        const need = consentNeed(asked.envelope.needs);
        expect(need).toMatchObject({
            consent: 'removeLink',
            preview: {
                action: 'Remove the Project Link',
                manifestPath: getProjectLinkManifestPath(root),
                current: { project: manifest.project, account: manifest.account },
            },
        });
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(true);

        const removed = await testCommand(consoleUnlinkDefinition, { dir: root, removeLink: need.digest });
        expect(removed.envelope).toMatchObject({
            status: 'ok',
            output: { removed: true, manifestPath: getProjectLinkManifestPath(root) },
        });
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('needs no consent for a project that is not linked', async () => {
        const root = project('none');

        const result = await testCommand(consoleUnlinkDefinition, { dir: root });

        expect(result.envelope).toMatchObject({
            status: 'ok',
            output: { removed: false, manifestPath: getProjectLinkManifestPath(root) },
        });
    });
});

describe('vendure console link', () => {
    it('repairs a valid link without a consent', async () => {
        const root = project();

        const result = await testCommand(consoleLinkDefinition, { dir: root });

        expect(result.envelope).toMatchObject({
            status: 'ok',
            output: {
                outcome: 'repaired',
                manifestPath: getProjectLinkManifestPath(root),
                project: manifest.project,
                account: manifest.account,
                plugins: {},
            },
        });
    });

    it('asks for the replaceLink consent for a manifest it cannot read, and goes on once it is given', async () => {
        const root = project('invalid');

        const asked = await testCommand(consoleLinkDefinition, { dir: root });
        const need = consentNeed(asked.envelope.needs);
        expect(need).toMatchObject({
            consent: 'replaceLink',
            preview: { manifestPath: getProjectLinkManifestPath(root) },
        });

        // With the consent, the link goes on to look for a login, which nobody stored.
        const replaced = await testCommand(consoleLinkDefinition, { dir: root, replaceLink: need.digest });
        expect(replaced.envelope.status).toBe('incomplete');
        expect(replaced.envelope.needs).toEqual([expect.objectContaining({ kind: 'input', field: 'token' })]);
        expect(fs.readFileSync(getProjectLinkManifestPath(root), 'utf-8')).toBe('{invalid');
    });

    it('asks for the replaceLink consent when --project may name another Project, with no login to check', async () => {
        const root = project();
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);

        const result = await testCommand(consoleLinkDefinition, { dir: root, project: 'storefront' });

        expect(fetch).not.toHaveBeenCalled();
        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.needs).toEqual([
            expect.objectContaining({
                kind: 'consent',
                consent: 'replaceLink',
                digest: expect.any(String),
                preview: expect.objectContaining({
                    manifestPath: getProjectLinkManifestPath(root),
                    current: { project: manifest.project, account: manifest.account },
                    requested: { project: 'storefront' },
                }),
            }),
        ]);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('replaces a link with another Project once the replaceLink consent is given', async () => {
        const root = project();
        vi.stubEnv('VENDURE_DISABLE_TELEMETRY', '1');
        storeLogin(process.env, 'https://api.vendure.io');
        const console = fakeConsole({
            projects: projectList([
                { id: PROJECT_ID, name: 'Storefront' },
                { id: OTHER_PROJECT_ID, name: 'Wholesale' },
            ]),
        });
        vi.stubGlobal('fetch', console.fetch);

        const asked = await testCommand(consoleLinkDefinition, { dir: root, project: 'wholesale' });
        const need = consentNeed(asked.envelope.needs);
        expect(need).toMatchObject({
            consent: 'replaceLink',
            preview: { requested: { project: 'wholesale' }, current: { project: manifest.project } },
        });
        expect(fs.readJsonSync(getProjectLinkManifestPath(root)).project.id).toBe(PROJECT_ID);

        const replaced = await testCommand(consoleLinkDefinition, {
            dir: root,
            project: 'wholesale',
            replaceLink: need.digest,
        });

        expect(replaced.envelope).toMatchObject({
            status: 'ok',
            output: { outcome: 'linked', project: { id: OTHER_PROJECT_ID } },
        });
        expect(fs.readJsonSync(getProjectLinkManifestPath(root)).project.id).toBe(OTHER_PROJECT_ID);
        const linkRequests = console.requests.filter(
            request => request.method === 'POST' && request.url.includes('/v1/projects/'),
        );
        expect(linkRequests.map(request => request.url)).toEqual([
            `https://api.vendure.io/v1/projects/${OTHER_PROJECT_ID}/link`,
        ]);
    });

    it('returns a coded error with the projects found when there is no Vendure project', async () => {
        const workspace = createVendureProject(directories, 'console-command-');
        fs.writeJsonSync(path.join(workspace, 'package.json'), { private: true });
        const server = path.join(workspace, 'server');
        fs.ensureDirSync(server);
        fs.writeJsonSync(path.join(server, 'package.json'), { dependencies: { '@vendure/core': '*' } });

        for (const definition of [consoleLinkDefinition, consoleUnlinkDefinition, consoleStatusDefinition]) {
            const result = await testCommand(definition, {}, { cwd: workspace });
            expect(result.envelope).toMatchObject({
                status: 'error',
                error: {
                    code: 'console.project-not-found',
                    fixes: [expect.objectContaining({ path: definition.path, input: { dir: 'server' } })],
                },
            });
        }
    });

    it('runs a link and its hooks once when a person is there, and tells them what a hook needs', async () => {
        const root = project();
        const hook = vi.fn<ConsoleLinkHook>(async context => {
            context.contributeResult({
                outcome: 'incomplete',
                data: { credential: 'missing' },
                needs: [{ kind: 'input', field: 'storeToken', description: 'The store token' }],
            });
        });
        setPluginExtensionAccessor(<T>(point: string) =>
            point === 'afterConsoleLink' ? [{ pluginId: '@example/setup', extension: hook as T }] : [],
        );
        const askInput = vi.fn(async () => 'answer');
        const prompter: Prompter = {
            askInput,
            askConsent: vi.fn(async () => true),
            confirm: vi.fn(async () => true),
            select: vi.fn(async () => undefined),
            text: vi.fn(async () => undefined),
        };

        const result = await testCommand(consoleLinkDefinition, { dir: root }, { prompter });

        expect(hook).toHaveBeenCalledOnce();
        expect(askInput).not.toHaveBeenCalled();
        expect(result.envelope).toMatchObject({
            status: 'failed',
            output: { outcome: 'repaired', plugins: { '@example/setup': { credential: 'missing' } } },
        });
        expect(result.envelope.notices).toContainEqual({ level: 'warning', message: 'The store token' });
    });

    function withHookNeeds(needs: CommandNeed[]) {
        const hook: ConsoleLinkHookRegistration = async context => {
            context.contributeResult({ outcome: 'incomplete', data: { credential: 'missing' }, needs });
        };
        setPluginExtensionAccessor(<T>(point: string) =>
            point === 'afterConsoleLink' ? [{ pluginId: '@example/setup', extension: hook as T }] : [],
        );
    }

    it('returns a hook need with a fix as a need, without a person', async () => {
        const root = project();
        const need: CommandNeed = {
            kind: 'input',
            field: 'token',
            description: 'A Console login',
            fix: { description: 'Sign in', path: ['auth', 'login'], input: { json: true } },
        };
        withHookNeeds([need]);

        const result = await testCommand(consoleLinkDefinition, { dir: root });

        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.needs).toEqual([need]);
        expect(result.envelope.output).toMatchObject({
            outcome: 'repaired',
            plugins: { '@example/setup': { credential: 'missing' } },
        });
    });

    it('reports a hook need without a fix as a next step, because the link does not take its field', async () => {
        const root = project();
        withHookNeeds([{ kind: 'input', field: 'storeToken', description: 'The store token' }]);

        const result = await testCommand(consoleLinkDefinition, { dir: root });

        expect(result.envelope.status).toBe('failed');
        expect(result.envelope.needs).toBeUndefined();
        expect(result.envelope.output).toMatchObject({
            outcome: 'repaired',
            plugins: { '@example/setup': { credential: 'missing' } },
            nextSteps: ['The store token'],
        });
        expect(result.envelope.notices).toContainEqual({ level: 'warning', message: 'The store token' });
    });

    it('refuses a --project that is a directory, and points to --dir', async () => {
        const root = project();
        const server = path.join(root, 'apps', 'server');
        fs.outputJsonSync(path.join(server, 'package.json'), { dependencies: { '@vendure/core': '4.0.0' } });

        const result = await testCommand(consoleLinkDefinition, { project: 'apps/server' }, { cwd: root });

        expect(result.envelope).toMatchObject({
            status: 'error',
            error: {
                code: 'console.project-is-directory',
                fixes: [
                    expect.objectContaining({ path: ['console', 'link'], input: { dir: 'apps/server' } }),
                ],
            },
        });
        expect(result.envelope.error?.message).toContain('--dir');
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('takes a --project that matches a directory of another kind as a slug', async () => {
        const root = project();
        fs.outputJsonSync(path.join(root, 'storefront', 'package.json'), {
            dependencies: { next: '15.0.0' },
        });

        const result = await testCommand(consoleLinkDefinition, { project: 'storefront' }, { cwd: root });

        // No login can read the linked Project's slug, so the CLI cannot tell whether it is the one.
        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.needs).toEqual([
            expect.objectContaining({
                kind: 'consent',
                consent: 'replaceLink',
                preview: expect.objectContaining({ requested: { project: 'storefront' } }),
            }),
        ]);
    });

    it('takes --project as the Console Project when --dir selects the directory', async () => {
        const workspace = createVendureProject(directories, 'console-command-');
        const server = path.join(workspace, 'parts-counter');
        fs.outputJsonSync(path.join(server, 'package.json'), { dependencies: { '@vendure/core': '4.0.0' } });
        fs.outputJsonSync(getProjectLinkManifestPath(server), manifest);

        const result = await testCommand(
            consoleLinkDefinition,
            { dir: 'parts-counter', project: 'parts-counter' },
            { cwd: workspace },
        );

        expect(result.envelope.error?.code).not.toBe('console.project-is-directory');
        expect(result.envelope.needs).toEqual([
            expect.objectContaining({
                consent: 'replaceLink',
                preview: expect.objectContaining({ requested: { project: 'parts-counter' } }),
            }),
        ]);
    });

    it('asks for the replaceLink consent when the lookup of the Project fails, and changes nothing', async () => {
        const root = project();
        storeLogin(process.env, 'https://api.vendure.io');
        const console = fakeConsole({
            projects: projectList([
                { id: PROJECT_ID, name: 'Storefront' },
                { id: OTHER_PROJECT_ID, name: 'Wholesale' },
            ]),
        });
        let projectLookups = 0;
        vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
            if (new URL(String(input)).pathname === '/v1/projects' && projectLookups++ === 0) {
                return Promise.resolve(new Response('{}', { status: 503 }));
            }
            return console.fetch(input, init);
        });

        const result = await testCommand(consoleLinkDefinition, { dir: root, project: 'wholesale' });

        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.needs).toEqual([
            expect.objectContaining({
                kind: 'consent',
                consent: 'replaceLink',
                preview: expect.objectContaining({ requested: { project: 'wholesale' } }),
            }),
        ]);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
        expect(
            console.requests.some(request => request.method === 'POST' && request.url.includes('/link')),
        ).toBe(false);
    });

    it('does not take yes in the input for the replaceLink consent', async () => {
        const root = project();

        const result = await testCommand(consoleLinkDefinition, {
            dir: root,
            project: 'storefront',
            yes: true,
        });

        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.needs).toEqual([expect.objectContaining({ consent: 'replaceLink' })]);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('refuses a replacement in a run that no plan asked a consent for', async () => {
        const root = project();
        const notice = vi.fn();
        const ctx: CommandContext = {
            cwd: root,
            signal: new AbortController().signal,
            mcp: false,
            notice,
            progress: () => undefined,
            event: () => undefined,
            spawn: () => Promise.reject(new Error('no processes in tests')),
        };

        const result = await runLink({ dir: root, project: 'storefront' }, ctx);

        expect(result).toMatchObject({ vendureResult: 'error', code: 'console.link-failed' });
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });
});

describe('vendure console status', () => {
    it('reports a linked project, without calling Console', async () => {
        const root = project();
        const fetch = vi.spyOn(globalThis, 'fetch');

        const result = await testCommand(consoleStatusDefinition, { dir: root });

        expect(fetch).not.toHaveBeenCalled();
        expect(result.envelope).toMatchObject({
            status: 'ok',
            output: {
                linked: true,
                manifestPath: getProjectLinkManifestPath(root),
                project: manifest.project,
                account: manifest.account,
                consoleUrl: 'https://console.vendure.io',
                consoleApiUrl: 'https://api.vendure.io',
                telemetry: { state: 'not-attributed' },
            },
        });
    });

    it('reports a project that is not linked', async () => {
        const root = project('none');

        const result = await testCommand(consoleStatusDefinition, { dir: root });

        expect(result.envelope).toMatchObject({
            status: 'ok',
            output: { linked: false, manifestPath: getProjectLinkManifestPath(root) },
        });
    });

    it('returns a coded error for a manifest it cannot read', async () => {
        const root = project('invalid');

        const result = await testCommand(consoleStatusDefinition, { dir: root });

        expect(result.envelope).toMatchObject({
            status: 'error',
            error: { code: 'console.manifest-invalid' },
        });
    });
});
