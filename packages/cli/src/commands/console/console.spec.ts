import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CliCommandExit } from '../../shared/cli-command-exit';

import { ConsoleCommandDependencies, consoleCommand, resolveConsoleEndpoints } from './console';
import { ConsoleReporter } from './console-reporter';
import {
    ACCOUNT_ID,
    NOW,
    OTHER_LINK_ID,
    OTHER_PROJECT_ID,
    PROJECT_ID,
    STORED_ACCESS_TOKEN,
    WORKOS_AUTHENTICATE_URL,
    accessToken,
    createCliConfigDir,
    fakeConsole,
    manifest,
    projectList,
    storeLogin,
} from './console.fixtures';
import { PROJECT_LINK_KEEP_MANIFEST } from './project-link-gitignore';
import { ProjectLinkManifest, getProjectLinkManifestPath } from './project-link-manifest';

const UUID_V7_LINK_ID = '33333333-3333-7333-8333-333333333333';
const LOCAL_CONSOLE = {
    appOrigin: 'http://localhost:3000',
    apiOrigin: 'http://localhost:3001',
};
const STAGING_CONSOLE = {
    appOrigin: 'https://staging.console.vendure.io',
    apiOrigin: 'https://staging.api.vendure.io',
};

const localManifest: ProjectLinkManifest = {
    ...manifest,
    schemaVersion: 1,
    console: LOCAL_CONSOLE,
};

const stagingManifest: ProjectLinkManifest = {
    ...manifest,
    schemaVersion: 1,
    console: STAGING_CONSOLE,
};

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.removeSync(directory);
    }
});

describe('console command', () => {
    it('reports missing and unknown actions with examples', async () => {
        const root = vendureProject();
        const first = testDependencies(root, vi.fn());
        const second = testDependencies(root, vi.fn());

        expect(await consoleCommand(undefined, {}, first.dependencies)).toBe(1);
        expect(await consoleCommand('unknown', {}, second.dependencies)).toBe(1);
        expect(first.messages.join('\n')).toContain('vendure console link');
        expect(second.messages.join('\n')).toContain('Unknown console action');
    });

    it.each([
        ['VENDURE_CONSOLE_LINK_URL', 'VENDURE_CONSOLE_APP_URL', 'https://console.example.com'],
        ['VENDURE_CONSOLE_LINK_API_URL', 'VENDURE_CONSOLE_API_URL', ''],
    ])('refuses the removed %s variable and names %s', async (removed, replacement, value) => {
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(vendureProject(), fetchMock, {
            env: { [removed]: value },
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(test.messages.join('\n')).toContain(`${removed} is no longer supported`);
        expect(test.messages.join('\n')).toContain(`Use ${replacement} instead`);
    });

    it('resolves the default working directory when the command runs', async () => {
        const root = vendureProject();
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch);
        delete test.dependencies.cwd;
        vi.spyOn(process, 'cwd').mockReturnValue(root);

        expect(await consoleCommand('status', {}, test.dependencies)).toBe(0);
        expect(test.messages.join('\n')).toContain('Project: Not linked');
    });

    it('requires paired endpoint overrides and validates origins', () => {
        expect(resolveConsoleEndpoints({})).toEqual({
            consoleUrl: 'https://console.vendure.io',
            apiUrl: 'https://api.vendure.io',
        });
        expect(
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_APP_URL: '',
                VENDURE_CONSOLE_API_URL: '   ',
            }),
        ).toEqual({
            consoleUrl: 'https://console.vendure.io',
            apiUrl: 'https://api.vendure.io',
        });
        expect(() => resolveConsoleEndpoints({ VENDURE_CONSOLE_APP_URL: 'http://localhost:3000' })).toThrow(
            'Set both',
        );
        expect(() =>
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_APP_URL: 'http://localhost:3000/path',
                VENDURE_CONSOLE_API_URL: 'http://localhost:3001',
            }),
        ).toThrow('without a path');
        expect(() =>
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_APP_URL: 'http://console.example.com',
                VENDURE_CONSOLE_API_URL: 'https://api.example.com',
            }),
        ).toThrow('must use HTTPS unless it is a loopback URL');
        expect(() =>
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_APP_URL: 'https://console.example.com',
                VENDURE_CONSOLE_API_URL: 'https://api.example.com',
            }),
        ).toThrow('not trusted');
        expect(() =>
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_APP_URL: 'https://staging.console.vendure.io',
                VENDURE_CONSOLE_API_URL: 'https://api.example.com',
            }),
        ).toThrow('not trusted');
        expect(() =>
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_APP_URL: 'https://console.vendure.io',
                VENDURE_CONSOLE_API_URL: 'https://staging.api.vendure.io',
            }),
        ).toThrow('Official Console app and API origins must be used as a matching pair');
    });

    it('uses a manifest Console when no variables are set and accepts matching variables', () => {
        expect(resolveConsoleEndpoints({}, STAGING_CONSOLE)).toEqual({
            consoleUrl: STAGING_CONSOLE.appOrigin,
            apiUrl: STAGING_CONSOLE.apiOrigin,
        });
        expect(
            resolveConsoleEndpoints(
                {
                    VENDURE_CONSOLE_APP_URL: STAGING_CONSOLE.appOrigin,
                    VENDURE_CONSOLE_API_URL: STAGING_CONSOLE.apiOrigin,
                },
                STAGING_CONSOLE,
            ),
        ).toEqual({
            consoleUrl: STAGING_CONSOLE.appOrigin,
            apiUrl: STAGING_CONSOLE.apiOrigin,
        });
    });

    it('refuses an environment Console that conflicts with the manifest and names both', () => {
        expect(() =>
            resolveConsoleEndpoints(
                {
                    VENDURE_CONSOLE_APP_URL: 'https://console.vendure.io',
                    VENDURE_CONSOLE_API_URL: 'https://api.vendure.io',
                },
                STAGING_CONSOLE,
            ),
        ).toThrow(/staging\.console\.vendure\.io[\s\S]*console\.vendure\.io/);
    });

    it('reports both Consoles and stops a command when the environment conflicts', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), stagingManifest);
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            env: {
                VENDURE_CONSOLE_APP_URL: 'https://console.vendure.io',
                VENDURE_CONSOLE_API_URL: 'https://api.vendure.io',
            },
        });

        expect(await consoleCommand('status', {}, test.dependencies)).toBe(1);
        const output = test.messages.join('\n');
        expect(output).toContain(STAGING_CONSOLE.appOrigin);
        expect(output).toContain('https://console.vendure.io');
        expect(output).toContain('conflicts with the Project Link Manifest');
    });

    it('refuses untrusted remote Console endpoints before any request', async () => {
        const env = {
            VENDURE_CLI_NON_INTERACTIVE: 'true',
            VENDURE_CONSOLE_APP_URL: 'https://console.staging.example.com',
            VENDURE_CONSOLE_API_URL: 'https://api.staging.example.com',
        };
        const blockedFetch = vi.fn() as unknown as typeof fetch;
        const blocked = testDependencies(vendureProject(), blockedFetch, { env });

        expect(await consoleCommand('link', {}, blocked.dependencies)).toBe(1);
        expect(blockedFetch).not.toHaveBeenCalled();
        expect(blocked.messages.join('\n')).toContain('not trusted');
    });

    it('reports the official production environment to a link hook', async () => {
        const seen: Array<string | undefined> = [];
        const test = testDependencies(
            vendureProject(),
            sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest)),
            {
                env: {},
                hooks: [
                    {
                        pluginId: '@example/p',
                        hook: async context => {
                            seen.push(context.endpoints.official);
                        },
                    },
                ],
            },
        );

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(seen).toEqual(['production']);
    });

    it('refuses custom remote Console origins before an interactive prompt', async () => {
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const prompt = vi.fn(() => Promise.resolve(false));
        const test = testDependencies(vendureProject(), fetchMock, {
            env: {
                VENDURE_CONSOLE_APP_URL: 'https://console.staging.example.com',
                VENDURE_CONSOLE_API_URL: 'https://api.staging.example.com',
            },
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(prompt).not.toHaveBeenCalled();
        expect(test.messages.join('\n')).toContain('not trusted');
    });

    it('links the only project of the organization with the CLI login and writes the manifest', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest));
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);

        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(localManifest);
        expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('.vendure/*');
        expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('!.vendure/project.json');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/v1/projects');
        expect(fetchMock.mock.calls[0][1]?.method).toBe('GET');
        expect(fetchMock.mock.calls[1][0]).toBe(`http://localhost:3001/v1/projects/${PROJECT_ID}/link`);
        expect(fetchMock.mock.calls[1][1]?.method).toBe('POST');
        for (const [, init] of fetchMock.mock.calls) {
            expect(init?.redirect).toBe('error');
            expect(init?.headers).toEqual({ Authorization: `Bearer ${STORED_ACCESS_TOKEN}` });
        }
        expect(test.messages.join('\n')).toContain('Updated');
        expect(test.messages.join('\n')).toContain('.gitignore');
    });

    it('uses an explicit staging Console for a new link and records it', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest));
        const test = testDependencies(root, fetchMock, {
            env: {
                VENDURE_CONSOLE_APP_URL: STAGING_CONSOLE.appOrigin,
                VENDURE_CONSOLE_API_URL: STAGING_CONSOLE.apiOrigin,
            },
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(stagingManifest);
        expect(fetchMock.mock.calls[0][0]).toBe(`${STAGING_CONSOLE.apiOrigin}/v1/projects`);
    });

    it('does not rewrite a gitignore that already has the Project Link rules', async () => {
        const root = vendureProject();
        const gitignore = ['node_modules', '.vendure/*', '!.vendure/project.json', ''].join('\n');
        fs.writeFileSync(path.join(root, '.gitignore'), gitignore);
        const fetchMock = sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest));
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe(gitignore);
        expect(test.messages.join('\n')).toContain('safe to commit');
    });

    it('still writes the manifest when the project gitignore cannot be updated', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.join(root, '.gitignore'));
        const fetchMock = sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest));
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(localManifest);
        expect(test.messages.join('\n')).toContain('Could not update');
    });

    it('links an apps/vendure monorepo from the workspace root and updates the project gitignore', async () => {
        const { workspace, project } = vendureMonorepo({ gitignore: 'node_modules\n' });
        const fetchMock = sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest));
        const test = testDependencies(workspace, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(project))).toEqual(localManifest);
        expect(fs.readFileSync(path.join(project, '.gitignore'), 'utf8')).toContain('.vendure/*');
        expect(fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8')).toBe('node_modules\n');
        expect(test.messages.join('\n')).toContain(path.join(project, '.gitignore'));
    });

    it('does not rewrite a monorepo root gitignore during link', async () => {
        const { workspace, project } = vendureMonorepo({ gitignore: '.vendure/\n' });
        const fetchMock = sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest));
        const test = testDependencies(workspace, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(project))).toEqual(localManifest);
        expect(fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8')).toBe('.vendure/\n');
        expect(fs.readFileSync(path.join(project, '.gitignore'), 'utf8')).toBe(
            '.vendure/*\n!.vendure/project.json\n',
        );
    });

    it('accepts unknown API fields, version-agnostic UUIDs and skips archived projects', async () => {
        const root = vendureProject();
        const versionSevenManifest: ProjectLinkManifest = {
            ...manifest,
            link: { id: UUID_V7_LINK_ID, protocolVersion: 1 },
        };
        const fetchMock = sequenceFetch(
            jsonResponse([
                ...projectList(),
                { id: OTHER_PROJECT_ID, name: 'Old shop', state: 'archived' },
                { id: '77777777-7777-7777-8777-777777777777', name: 'Next', state: 'future-state' },
            ]),
            jsonResponse(versionSevenManifest),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fetchMock.mock.calls[1][0]).toBe(`http://localhost:3001/v1/projects/${PROJECT_ID}/link`);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual({
            ...versionSevenManifest,
            schemaVersion: 1,
            console: LOCAL_CONSOLE,
        });
    });

    it('asks which project to link when the organization has several', async () => {
        const root = vendureProject();
        const other = { ...manifest, project: { id: OTHER_PROJECT_ID, name: 'Wholesale' } };
        const fetchMock = sequenceFetch(
            jsonResponse(
                projectList([
                    { id: PROJECT_ID, name: 'Storefront' },
                    { id: OTHER_PROJECT_ID, name: 'Wholesale' },
                ]),
            ),
            jsonResponse(other),
        );
        const select = vi.fn(() => Promise.resolve(OTHER_PROJECT_ID));
        const test = testDependencies(root, fetchMock, { isNonInteractive: () => false, select });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(select).toHaveBeenCalledWith(expect.stringContaining('Acme'), [
            { value: PROJECT_ID, label: 'Storefront' },
            { value: OTHER_PROJECT_ID, label: 'Wholesale' },
        ]);
        expect(fetchMock.mock.calls[1][0]).toBe(`http://localhost:3001/v1/projects/${OTHER_PROJECT_ID}/link`);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root)).project.name).toBe('Wholesale');
    });

    it('does not guess between several projects without a terminal, and lists them', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(
                projectList([
                    { id: PROJECT_ID, name: 'Storefront' },
                    { id: OTHER_PROJECT_ID, name: 'Wholesale' },
                ]),
            ),
        );
        const select = vi.fn();
        const test = testDependencies(root, fetchMock, { select });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(select).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(test.messages.join('\n')).toContain(`Wholesale (${OTHER_PROJECT_ID})`);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('names the Console to create a project in when the organization has none', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(projectList([{ id: PROJECT_ID, name: 'Storefront', state: 'archived' }])),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(test.messages.join('\n')).toContain('Acme has no active project');
        expect(test.messages.join('\n')).toContain(LOCAL_CONSOLE.appOrigin);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('does not write a manifest when Console refuses the link or returns a malformed manifest', async () => {
        const refusedRoot = vendureProject();
        const refused = testDependencies(
            refusedRoot,
            sequenceFetch(jsonResponse(projectList()), new Response('{}', { status: 403 })),
        );
        expect(await consoleCommand('link', {}, refused.dependencies)).toBe(1);
        expect(refused.messages.join('\n')).toContain('does not allow you to link Storefront');
        expect(fs.existsSync(getProjectLinkManifestPath(refusedRoot))).toBe(false);
        expect(fs.existsSync(path.join(refusedRoot, '.gitignore'))).toBe(false);

        const malformedRoot = vendureProject();
        const malformed = testDependencies(
            malformedRoot,
            sequenceFetch(jsonResponse(projectList()), jsonResponse({ ...manifest, secret: 'value' })),
        );
        expect(await consoleCommand('link', {}, malformed.dependencies)).toBe(1);
        expect(fs.existsSync(getProjectLinkManifestPath(malformedRoot))).toBe(false);
        expect(malformed.messages.join('\n')).not.toContain('value');
    });

    it('reports a project that is no longer active without writing a manifest', async () => {
        const root = vendureProject();
        const test = testDependencies(
            root,
            sequenceFetch(jsonResponse(projectList()), new Response('{}', { status: 404 })),
        );

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(test.messages.join('\n')).toContain('Storefront is no longer an active project in Acme');
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('aborts a stalled response body instead of hanging', async () => {
        const root = vendureProject();
        const externalAbort = new AbortController();
        const hanging = new Promise<never>(() => undefined);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => hanging,
            text: () => hanging,
            body: {
                getReader: () => ({
                    read: () => hanging,
                    cancel: () => Promise.resolve(),
                    releaseLock: () => undefined,
                }),
            },
        }) as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock, {
            signal: externalAbort.signal,
        });
        const pending = consoleCommand('link', {}, test.dependencies);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
        externalAbort.abort();

        expect(await pending).toBe(130);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('rejects an oversized Console API response', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse([{ ...(projectList()[0] as object), padding: 'x'.repeat(1_100_000) }]),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(test.messages.join('\n')).toContain('maximum size');
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('renews the CLI login once when Console refuses its access token', async () => {
        const root = vendureProject();
        const api = fakeConsole({
            link: (projectId, authorization) =>
                authorization === `Bearer ${STORED_ACCESS_TOKEN}`
                    ? jsonResponse({}, 401)
                    : jsonResponse({ ...manifest, project: { ...manifest.project, id: projectId } }),
        });
        const test = testDependencies(root, api.fetch);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        const links = api.requests.filter(request => request.url.endsWith('/link'));
        expect(links.map(request => request.authorization)).toEqual([
            `Bearer ${STORED_ACCESS_TOKEN}`,
            `Bearer ${accessToken('issued-1')}`,
        ]);
        expect(api.requests.filter(request => request.url === WORKOS_AUTHENTICATE_URL)).toHaveLength(1);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(true);
    });

    it('stops when Console refuses the renewed access token too', async () => {
        const root = vendureProject();
        const api = fakeConsole({ link: () => jsonResponse({}, 401) });
        const test = testDependencies(root, api.fetch);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(api.requests.filter(request => request.url.endsWith('/link'))).toHaveLength(2);
        expect(test.messages.join('\n')).toContain('did not accept the CLI login');
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('refuses a manifest for a project other than the one it linked', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(projectList()),
            jsonResponse({ ...manifest, project: { id: OTHER_PROJECT_ID, name: 'Wholesale' } }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(test.messages.join('\n')).toContain('for a different project');
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('does not repeat a link request that failed', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(projectList()),
            new Response('', { status: 503 }),
            jsonResponse(manifest),
        );
        const test = testDependencies(root, fetchMock);

        // A repeated link records another Project Link, so a failure is reported, not retried.
        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(test.messages.join('\n')).toContain('HTTP 503');
    });

    it('never prints the access token when Console becomes unreachable', async () => {
        const root = vendureProject();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse(projectList()))
            .mockRejectedValue(new Error(`network error ${STORED_ACCESS_TOKEN}`)) as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect([...test.messages, ...test.urls].join('\n')).not.toContain(STORED_ACCESS_TOKEN);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('reports a role that cannot list projects', async () => {
        const root = vendureProject();
        const test = testDependencies(root, sequenceFetch(new Response('{}', { status: 403 })));

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(test.messages.join('\n')).toContain('does not allow you to see its projects');
    });

    it('does not let --force bypass a cross-root Project Link Manifest', async () => {
        const { workspace, project } = vendureMonorepo();
        const ancestorManifest = getProjectLinkManifestPath(workspace);
        fs.ensureDirSync(path.dirname(ancestorManifest));
        fs.writeJsonSync(ancestorManifest, manifest);
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(workspace, fetchMock);

        expect(await consoleCommand('link', { project, force: true }, test.dependencies)).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(test.messages.join('\n')).toContain('outside the selected Vendure project');
    });

    it('fails closed for replacement in non-interactive mode and allows --force', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        // An invalid manifest is the case that still has to be replaced: there
        // is no link in it to repair, so the command needs a decision.
        fs.writeFileSync(getProjectLinkManifestPath(root), '{invalid');
        const blockedFetch = vi.fn() as unknown as typeof fetch;
        const blocked = testDependencies(root, blockedFetch);

        expect(await consoleCommand('link', {}, blocked.dependencies)).toBe(1);
        expect(blockedFetch).not.toHaveBeenCalled();
        expect(fs.readFileSync(getProjectLinkManifestPath(root), 'utf-8')).toBe('{invalid');

        const replacement = { ...manifest, project: { ...manifest.project, name: 'Replacement' } };
        const allowed = testDependencies(
            root,
            sequenceFetch(jsonResponse(projectList()), jsonResponse(replacement)),
        );
        expect(await consoleCommand('link', { force: true }, allowed.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual({
            ...replacement,
            schemaVersion: 1,
            console: LOCAL_CONSOLE,
        });
    });

    it('uses --force to replace a valid manifest with a new Project Link', async () => {
        const root = vendureProject();
        const previous: ProjectLinkManifest = {
            ...localManifest,
            project: { ...manifest.project, name: 'Previous' },
            link: { ...manifest.link, id: OTHER_LINK_ID },
        };
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), previous);
        const contexts: Array<{ force: boolean; outcome: string }> = [];
        const fetchMock = sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest));
        const test = testDependencies(root, fetchMock, {
            hooks: [
                {
                    pluginId: '@example/p',
                    hook: async context => {
                        contexts.push({ force: context.force, outcome: context.outcome });
                    },
                },
            ],
        });

        expect(await consoleCommand('link', { force: true }, test.dependencies)).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(localManifest);
        expect(contexts).toEqual([{ force: true, outcome: 'linked' }]);
    });

    it('uses --yes for every CLI confirmation without forcing a new link', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const hook = vi.fn(async () => undefined);
        const prompt = vi.fn(() => Promise.resolve(false));
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock, {
            hooks: [{ pluginId: '@example/p', hook }],
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', { yes: true }, test.dependencies)).toBe(0);
        expect(prompt).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(hook).toHaveBeenCalledOnce();
    });

    it('uses --yes to approve manifest replacement and removal', async () => {
        const replacementRoot = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(replacementRoot)));
        fs.writeFileSync(getProjectLinkManifestPath(replacementRoot), '{invalid');
        const replacementPrompt = vi.fn(() => Promise.resolve(false));
        const replacement = testDependencies(
            replacementRoot,
            sequenceFetch(jsonResponse(projectList()), jsonResponse(manifest)),
            { isNonInteractive: () => false, prompt: replacementPrompt },
        );

        expect(await consoleCommand('link', { yes: true }, replacement.dependencies)).toBe(0);
        expect(replacementPrompt).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(replacementRoot))).toEqual(localManifest);

        const unlinkRoot = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(unlinkRoot)));
        fs.writeJsonSync(getProjectLinkManifestPath(unlinkRoot), manifest);
        const unlinkPrompt = vi.fn(() => Promise.resolve(false));
        const unlink = testDependencies(unlinkRoot, vi.fn() as unknown as typeof fetch, {
            isNonInteractive: () => false,
            prompt: unlinkPrompt,
        });

        expect(await consoleCommand('unlink', { yes: true }, unlink.dependencies)).toBe(0);
        expect(unlinkPrompt).not.toHaveBeenCalled();
        expect(fs.existsSync(getProjectLinkManifestPath(unlinkRoot))).toBe(false);
    });

    it('validates Console endpoints before prompting to replace a manifest', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const prompt = vi.fn(() => Promise.resolve(true));
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            env: { VENDURE_CONSOLE_APP_URL: 'https://console.example.com' },
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(prompt).not.toHaveBeenCalled();
        expect(test.messages.join('\n')).toContain('Set both VENDURE_CONSOLE_APP_URL');
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('rethrows CliCommandExit from the prompt so the CLI host owns the exit', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeFileSync(getProjectLinkManifestPath(root), '{invalid');
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            isNonInteractive: () => false,
            prompt: () => Promise.reject(new CliCommandExit(1)),
        });

        await expect(consoleCommand('link', {}, test.dependencies)).rejects.toBeInstanceOf(CliCommandExit);
        expect(test.messages.join('\n')).not.toContain('requested exit code');
        expect(fs.readFileSync(getProjectLinkManifestPath(root), 'utf-8')).toBe('{invalid');
    });

    it('leaves an invalid manifest unchanged when interactive replacement is cancelled', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeFileSync(getProjectLinkManifestPath(root), '{invalid');
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock, {
            isNonInteractive: () => false,
            prompt: () => Promise.resolve(false),
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readFileSync(getProjectLinkManifestPath(root), 'utf-8')).toBe('{invalid');
    });

    // Repeating a link is how a project that is already linked gets its setup
    // run again. Minting a second Project Link would abandon the first.
    it('repeats a link without asking Console for another one, and names --force', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock, { env: {} });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual({
            ...manifest,
            schemaVersion: 1,
            console: {
                appOrigin: 'https://console.vendure.io',
                apiOrigin: 'https://api.vendure.io',
            },
        });
        const output = test.messages.join('\n');
        expect(output).toContain('Already linked to');
        expect(output).toContain('vendure console link --force');
    });

    // A manifest is meant to be committed, so an already-linked project may be
    // one the developer has just cloned.
    it('names the project before running plugin setup against a manifest it did not write', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const hook = vi.fn(async () => undefined);
        const prompt = vi.fn(() => Promise.resolve(false));
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            hooks: [{ pluginId: '@example/p', hook }],
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(prompt).toHaveBeenCalledWith(expect.stringContaining(manifest.project.name));
        expect(prompt).toHaveBeenCalledWith(expect.stringContaining(manifest.account.name));
        expect(hook).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(localManifest);
    });

    it('does not ask before a repair that would run no plugin setup', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const prompt = vi.fn(() => Promise.resolve(true));
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            isNonInteractive: () => false,
            prompt,
        });

        // With no hooks registered there is nothing to approve.
        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(prompt).not.toHaveBeenCalled();
    });

    it('uses the manifest staging Console for a repair without environment variables', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), stagingManifest);
        const prompt = vi.fn(() => Promise.resolve(true));
        const seen: Array<string | undefined> = [];
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            env: {},
            hooks: [
                {
                    pluginId: '@example/p',
                    hook: async context => {
                        seen.push(context.endpoints.official);
                    },
                },
            ],
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', { yes: true }, test.dependencies)).toBe(0);
        expect(prompt).not.toHaveBeenCalled();
        expect(seen).toEqual(['staging']);
    });

    it('uses explicit staging origins to repair a manifest without Console metadata', async () => {
        const root = vendureProject();
        const manifestPath = getProjectLinkManifestPath(root);
        fs.ensureDirSync(path.dirname(manifestPath));
        fs.writeJsonSync(manifestPath, manifest);
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock, {
            env: {
                VENDURE_CONSOLE_APP_URL: STAGING_CONSOLE.appOrigin,
                VENDURE_CONSOLE_API_URL: STAGING_CONSOLE.apiOrigin,
            },
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readJsonSync(manifestPath)).toEqual(stagingManifest);
    });

    it('does not claim an upgraded manifest is unchanged when plugin setup is declined', async () => {
        const root = vendureProject();
        const manifestPath = getProjectLinkManifestPath(root);
        fs.ensureDirSync(path.dirname(manifestPath));
        fs.writeJsonSync(manifestPath, manifest);
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            env: {},
            hooks: [{ pluginId: '@example/p', hook: vi.fn(async () => undefined) }],
            isNonInteractive: () => false,
            prompt: () => Promise.resolve(false),
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(manifestPath)).toEqual({
            ...manifest,
            console: {
                appOrigin: 'https://console.vendure.io',
                apiOrigin: 'https://api.vendure.io',
            },
        });
        expect(test.messages.join('\n')).not.toContain('Project Link Manifest is unchanged');
    });

    it('runs plugin setup on a repair once the prompt is accepted', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const outcomes: string[] = [];
        const prompt = vi.fn(() => Promise.resolve(true));
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            hooks: [
                {
                    pluginId: '@example/p',
                    hook: async context => {
                        outcomes.push(context.outcome);
                    },
                },
            ],
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(prompt).toHaveBeenCalledTimes(1);
        expect(outcomes).toEqual(['repaired']);
    });

    it('skips the repair prompt for --yes without linking to a different Project', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const hook = vi.fn(async () => undefined);
        const prompt = vi.fn(() => Promise.resolve(true));
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock, {
            hooks: [{ pluginId: '@example/p', hook }],
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', { yes: true }, test.dependencies)).toBe(0);
        expect(prompt).not.toHaveBeenCalled();
        expect(hook).toHaveBeenCalledTimes(1);
        // `--yes` answers the question. It does not create a second Project Link.
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(localManifest);
    });

    it('applies the gitignore rules on a repair whose plugin setup is declined', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const hook = vi.fn(async () => undefined);
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            hooks: [{ pluginId: '@example/p', hook }],
            isNonInteractive: () => false,
            prompt: () => Promise.resolve(false),
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(hook).not.toHaveBeenCalled();
        // Declining plugin setup does not decline the rules this path writes.
        expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf-8')).toContain(PROJECT_LINK_KEEP_MANIFEST);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(localManifest);
        expect(test.messages.join('\n')).toContain('No plugin setup was run');
    });

    it('repairs rather than failing closed when a linked project repeats a link non-interactively', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock);

        // The backfill path a linked project needs has to work in CI, where
        // there is nobody to confirm anything and nothing to confirm.
        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(localManifest);
    });

    it('refuses an untrusted endpoint when a link is repeated', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock, {
            env: {
                VENDURE_CLI_NON_INTERACTIVE: 'true',
                VENDURE_CONSOLE_APP_URL: 'https://console.staging.example.com',
                VENDURE_CONSOLE_API_URL: 'https://api.staging.example.com',
            },
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(test.messages.join('\n')).toContain('not trusted');
    });

    it('returns an interrupt exit code when the confirmation prompt is cancelled', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            isNonInteractive: () => false,
            prompt: () => Promise.resolve(undefined),
        });

        expect(await consoleCommand('unlink', {}, test.dependencies)).toBe(130);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(localManifest);
    });

    it('reports linked, unlinked, and malformed status without network access', async () => {
        const root = vendureProject();
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const unlinked = testDependencies(root, fetchMock);
        expect(await consoleCommand('status', {}, unlinked.dependencies)).toBe(0);
        expect(unlinked.messages.join('\n')).toContain('Project: Not linked');

        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), localManifest);
        const linked = testDependencies(root, fetchMock);
        expect(await consoleCommand('status', {}, linked.dependencies)).toBe(0);
        expect(linked.messages.join('\n')).toContain(`Account: Acme (${ACCOUNT_ID})`);
        expect(linked.messages.join('\n')).toContain(`Manifest: ${getProjectLinkManifestPath(root)}`);
        expect(linked.messages.join('\n')).toContain(`Console: ${LOCAL_CONSOLE.appOrigin}`);
        // The login is `vendure auth status`'s to report.
        expect(linked.messages.join('\n')).toContain('Login: run vendure auth status');
        expect(linked.messages.join('\n')).not.toContain('dev@example.com');

        fs.writeFileSync(getProjectLinkManifestPath(root), '{invalid');
        const malformed = testDependencies(root, fetchMock);
        expect(await consoleCommand('status', {}, malformed.dependencies)).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses explicit staging origins for status when the manifest has no Console metadata', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            env: {
                VENDURE_CONSOLE_APP_URL: STAGING_CONSOLE.appOrigin,
                VENDURE_CONSOLE_API_URL: STAGING_CONSOLE.apiOrigin,
            },
        });

        expect(await consoleCommand('status', {}, test.dependencies)).toBe(0);
        expect(test.messages.join('\n')).toContain(`Console: ${STAGING_CONSOLE.appOrigin}`);
    });

    it('unlinks only the local manifest after explicit confirmation', async () => {
        const root = vendureProject();
        const manifestPath = getProjectLinkManifestPath(root);
        const siblingPath = path.join(path.dirname(manifestPath), 'credentials.json');
        fs.ensureDirSync(path.dirname(manifestPath));
        fs.writeJsonSync(manifestPath, manifest);
        fs.writeFileSync(siblingPath, 'machine-local');
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch);

        expect(await consoleCommand('unlink', { force: true }, test.dependencies)).toBe(0);
        expect(fs.existsSync(manifestPath)).toBe(false);
        expect(fs.readFileSync(siblingPath, 'utf8')).toBe('machine-local');
        expect(fs.existsSync(path.dirname(manifestPath))).toBe(true);
    });

    it('returns an interrupt exit code and leaves no partial manifest', async () => {
        const root = vendureProject();
        const externalAbort = new AbortController();
        const test = testDependencies(
            root,
            sequenceFetch(
                jsonResponse(
                    projectList([
                        { id: PROJECT_ID, name: 'Storefront' },
                        { id: OTHER_PROJECT_ID, name: 'Wholesale' },
                    ]),
                ),
            ),
            {
                signal: externalAbort.signal,
                isNonInteractive: () => false,
                select: () => {
                    externalAbort.abort();
                    return Promise.resolve(undefined);
                },
            },
        );

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(130);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
        expect(test.messages.join('\n')).toContain('No Project Link Manifest was changed');
    });
});

/**
 * Dependencies for one run. The CLI login lives in a temporary config
 * directory and holds a login for the run's Console API, scoped to the Acme
 * organization.
 */
function testDependencies(
    root: string,
    fetchImplementation: typeof fetch,
    overrides: Partial<ConsoleCommandDependencies> = {},
): {
    dependencies: Partial<ConsoleCommandDependencies>;
    messages: string[];
    urls: string[];
} {
    const messages: string[] = [];
    const urls: string[] = [];
    const env: NodeJS.ProcessEnv = {
        ...(overrides.env ?? {
            VENDURE_CLI_NON_INTERACTIVE: 'true',
            VENDURE_CONSOLE_APP_URL: 'http://localhost:3000',
            VENDURE_CONSOLE_API_URL: 'http://localhost:3001',
        }),
        VENDURE_CLI_CONFIG_DIR: createCliConfigDir(temporaryDirectories),
    };
    storeLogin(env, env.VENDURE_CONSOLE_API_URL?.trim() || 'https://api.vendure.io');
    const reporter: ConsoleReporter = {
        error: message => messages.push(message),
        info: message => messages.push(message),
        success: message => messages.push(message),
        warn: message => messages.push(message),
        url: value => urls.push(value),
    };
    return {
        dependencies: {
            cwd: root,
            fetch: fetchImplementation,
            isNonInteractive: () => true,
            now: () => NOW,
            openUrl: () => Promise.resolve(),
            prompt: () => Promise.resolve(true),
            select: () => Promise.resolve(undefined),
            reporter,
            ...overrides,
            env,
        },
        messages,
        urls,
    };
}

function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function sequenceFetch(...responses: Response[]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn();
    for (const response of responses) {
        fetchMock.mockResolvedValueOnce(response);
    }
    return fetchMock;
}

function vendureProject(): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-command-')));
    temporaryDirectories.push(root);
    fs.writeJsonSync(path.join(root, 'package.json'), {
        dependencies: { '@vendure/core': '3.7.2' },
    });
    return root;
}

function vendureMonorepo(options: { gitignore?: string } = {}): { workspace: string; project: string } {
    const workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-monorepo-')));
    temporaryDirectories.push(workspace);
    fs.ensureDirSync(path.join(workspace, '.git'));
    fs.writeJsonSync(path.join(workspace, 'package.json'), { private: true });
    if (options.gitignore !== undefined) {
        fs.writeFileSync(path.join(workspace, '.gitignore'), options.gitignore);
    }
    const project = path.join(workspace, 'apps', 'vendure');
    fs.ensureDirSync(project);
    fs.writeJsonSync(path.join(project, 'package.json'), {
        dependencies: { '@vendure/core': '3.7.2' },
    });
    return { workspace, project: fs.realpathSync(project) };
}
