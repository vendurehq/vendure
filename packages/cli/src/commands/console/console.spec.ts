import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CliCommandExit } from '../../shared/cli-command-exit';

import {
    ConsoleCommandDependencies,
    ConsoleReporter,
    consoleCommand,
    resolveConsoleEndpoints,
} from './console';
import {
    ACCOUNT_ID,
    LINK_ID,
    NOW,
    POLLING_SECRET,
    createResponse,
    expiry,
    manifest,
} from './console.fixtures';
import { ProjectLinkManifest, getProjectLinkManifestPath } from './project-link-manifest';

const UUID_V7_LINK_ID = '33333333-3333-7333-8333-333333333333';

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
                VENDURE_CONSOLE_LINK_URL: '',
                VENDURE_CONSOLE_LINK_API_URL: '   ',
            }),
        ).toEqual({
            consoleUrl: 'https://console.vendure.io',
            apiUrl: 'https://api.vendure.io',
        });
        expect(() => resolveConsoleEndpoints({ VENDURE_CONSOLE_LINK_URL: 'http://localhost:3000' })).toThrow(
            'Set both',
        );
        expect(() =>
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_LINK_URL: 'http://localhost:3000/path',
                VENDURE_CONSOLE_LINK_API_URL: 'http://localhost:3001',
            }),
        ).toThrow('without a path');
        expect(() =>
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_LINK_URL: 'http://console.example.com',
                VENDURE_CONSOLE_LINK_API_URL: 'https://api.example.com',
            }),
        ).toThrow('must use HTTPS unless it is a loopback URL');
        expect(() =>
            resolveConsoleEndpoints({
                VENDURE_CONSOLE_LINK_URL: 'https://console.example.com',
                VENDURE_CONSOLE_LINK_API_URL: 'https://api.vendure.io',
            }),
        ).toThrow('production Console and API origins must be used together');
    });

    it('requires explicit approval for custom remote Console endpoints in non-interactive mode', async () => {
        const env = {
            VENDURE_CLI_NON_INTERACTIVE: 'true',
            VENDURE_CONSOLE_LINK_URL: 'https://console.staging.example.com',
            VENDURE_CONSOLE_LINK_API_URL: 'https://api.staging.example.com',
        };
        const blockedFetch = vi.fn() as unknown as typeof fetch;
        const blocked = testDependencies(vendureProject(), blockedFetch, { env });

        expect(await consoleCommand('link', {}, blocked.dependencies)).toBe(1);
        expect(blockedFetch).not.toHaveBeenCalled();
        expect(blocked.messages.join('\n')).toContain('--allow-custom-console');

        const allowedFetch = sequenceFetch(
            jsonResponse(createResponse()),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const allowed = testDependencies(vendureProject(), allowedFetch, { env });

        expect(await consoleCommand('link', { allowCustomConsole: true }, allowed.dependencies)).toBe(0);
        expect(allowedFetch).toHaveBeenCalledTimes(2);
    });

    it('shows custom remote Console origins before an interactive request', async () => {
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const prompt = vi.fn(() => Promise.resolve(false));
        const test = testDependencies(vendureProject(), fetchMock, {
            env: {
                VENDURE_CONSOLE_LINK_URL: 'https://console.staging.example.com',
                VENDURE_CONSOLE_LINK_API_URL: 'https://api.staging.example.com',
            },
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(prompt).toHaveBeenCalledWith(expect.stringContaining('console.staging.example.com'));
        expect(prompt).toHaveBeenCalledWith(expect.stringContaining('api.staging.example.com'));
    });

    it('completes create, pending poll, approval, and atomic manifest write', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            jsonResponse({ state: 'pending', expiresAt: expiry() }),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);

        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
        expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('.vendure/*');
        expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toContain('!.vendure/project.json');
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:3001/v1/project-links');
        expect(fetchMock.mock.calls[1][0]).toBe(
            `http://localhost:3001/v1/project-links/${LINK_ID}/poll`,
        );
        expect(fetchMock.mock.calls[0][1]?.redirect).toBe('error');
        expect(fetchMock.mock.calls[1][1]?.redirect).toBe('error');
        expect(fetchMock.mock.calls[1][1]?.body).toBe(JSON.stringify({ pollingSecret: POLLING_SECRET }));
        expect(test.messages.join('\n')).toContain('Updated');
        expect(test.messages.join('\n')).toContain('.gitignore');
    });

    it('does not rewrite a gitignore that already has the Project Link rules', async () => {
        const root = vendureProject();
        const gitignore = ['node_modules', '.vendure/*', '!.vendure/project.json', ''].join('\n');
        fs.writeFileSync(path.join(root, '.gitignore'), gitignore);
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe(gitignore);
        expect(test.messages.join('\n')).toContain('safe to commit');
    });

    it('still writes the manifest when the project gitignore cannot be updated', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.join(root, '.gitignore'));
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
        expect(test.messages.join('\n')).toContain('Could not update');
    });

    it('links an apps/vendure monorepo from the workspace root and updates the project gitignore', async () => {
        const { workspace, project } = vendureMonorepo({ gitignore: 'node_modules\n' });
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(workspace, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(project))).toEqual(manifest);
        expect(fs.readFileSync(path.join(project, '.gitignore'), 'utf8')).toContain('.vendure/*');
        expect(fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8')).toBe('node_modules\n');
        expect(test.messages.join('\n')).toContain(path.join(project, '.gitignore'));
    });

    it('does not rewrite a monorepo root gitignore during link', async () => {
        const { workspace, project } = vendureMonorepo({ gitignore: '.vendure/\n' });
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(workspace, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(project))).toEqual(manifest);
        expect(fs.readFileSync(path.join(workspace, '.gitignore'), 'utf8')).toBe('.vendure/\n');
        expect(fs.readFileSync(path.join(project, '.gitignore'), 'utf8')).toBe(
            '.vendure/*\n!.vendure/project.json\n',
        );
    });

    it('accepts unknown API fields and version-agnostic UUIDs', async () => {
        const root = vendureProject();
        const versionSevenManifest: ProjectLinkManifest = {
            ...manifest,
            link: { id: UUID_V7_LINK_ID, protocolVersion: 1 },
        };
        const fetchMock = sequenceFetch(
            jsonResponse({
                ...createResponse(),
                id: UUID_V7_LINK_ID,
                verificationPath: `/?link=${UUID_V7_LINK_ID}`,
                serverCapability: 'future-value',
            }),
            jsonResponse({ state: 'pending', expiresAt: expiry(), retryHint: 'future-value' }),
            jsonResponse({
                state: 'approved',
                expiresAt: expiry(),
                manifest: versionSevenManifest,
                auditId: 'future-value',
            }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(versionSevenManifest);
    });

    it('prints the safe verification URL and continues when browser launch fails', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(root, fetchMock, {
            openUrl: () => Promise.reject(new Error('browser unavailable')),
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(test.urls).toEqual([`http://localhost:3000/?link=${LINK_ID}`]);
        expect(test.messages.join('\n')).not.toContain(POLLING_SECRET);
    });

    it('does not write a manifest after denial or a malformed approval', async () => {
        const deniedRoot = vendureProject();
        const denied = testDependencies(
            deniedRoot,
            sequenceFetch(
                jsonResponse(createResponse()),
                jsonResponse({ state: 'denied', expiresAt: expiry() }),
            ),
        );
        expect(await consoleCommand('link', {}, denied.dependencies)).toBe(1);
        expect(fs.existsSync(getProjectLinkManifestPath(deniedRoot))).toBe(false);
        expect(fs.existsSync(path.join(deniedRoot, '.gitignore'))).toBe(false);

        const malformedRoot = vendureProject();
        const malformed = testDependencies(
            malformedRoot,
            sequenceFetch(
                jsonResponse(createResponse()),
                jsonResponse({
                    state: 'approved',
                    expiresAt: expiry(),
                    manifest: { ...manifest, pollingSecret: POLLING_SECRET },
                }),
            ),
        );
        expect(await consoleCommand('link', {}, malformed.dependencies)).toBe(1);
        expect(fs.existsSync(getProjectLinkManifestPath(malformedRoot))).toBe(false);
        expect(malformed.messages.join('\n')).not.toContain(POLLING_SECRET);
    });

    it('reports an expired request without writing a manifest', async () => {
        const root = vendureProject();
        const test = testDependencies(
            root,
            sequenceFetch(
                jsonResponse(createResponse()),
                jsonResponse({ state: 'expired', expiresAt: new Date(NOW - 1).toISOString() }),
            ),
        );

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(test.messages.join('\n')).toContain('request expired');
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
            jsonResponse({
                ...createResponse(),
                padding: 'x'.repeat(70_000),
            }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(test.messages.join('\n')).toContain('maximum size');
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('retries HTTP 429 poll responses as transient failures', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            new Response('', { status: 429 }),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(test.sleeps).toEqual([500]);
    });

    it('rejects a non-string poll state instead of treating it as pending', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            jsonResponse({ state: ['approved'], expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(test.messages.join('\n')).toContain('unknown Project Link state');
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('retries transient poll failures until expiry and does not retry request creation', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse()),
            new Response('', { status: 503 }),
            new Response('', { status: 502 }),
            new Response('', { status: 503 }),
            new Response('', { status: 502 }),
            jsonResponse({ state: 'approved', expiresAt: expiry(), manifest }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(test.sleeps).toEqual([500, 1_000, 2_000, 2_000]);

        const createFailure = vi.fn(() =>
            Promise.resolve(new Response('', { status: 503 })),
        ) as unknown as typeof fetch;
        const failed = testDependencies(vendureProject(), createFailure);
        expect(await consoleCommand('link', {}, failed.dependencies)).toBe(1);
        expect(createFailure).toHaveBeenCalledOnce();
    });

    it('never prints the polling secret when polling becomes unreachable', async () => {
        const root = vendureProject();
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(jsonResponse(createResponse(new Date(NOW + 1_500).toISOString())))
            .mockRejectedValue(new Error(`network error ${POLLING_SECRET}`)) as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect([...test.messages, ...test.urls].join('\n')).not.toContain(POLLING_SECRET);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
    });

    it('uses the latest expiry returned by polling', async () => {
        const root = vendureProject();
        const fetchMock = sequenceFetch(
            jsonResponse(createResponse(new Date(NOW + 1_000).toISOString())),
            jsonResponse({ state: 'pending', expiresAt: new Date(NOW + 5_000).toISOString() }),
            jsonResponse({
                state: 'approved',
                expiresAt: new Date(NOW + 5_000).toISOString(),
                manifest,
            }),
        );
        const test = testDependencies(root, fetchMock);

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
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
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const blockedFetch = vi.fn() as unknown as typeof fetch;
        const blocked = testDependencies(root, blockedFetch);

        expect(await consoleCommand('link', {}, blocked.dependencies)).toBe(1);
        expect(blockedFetch).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);

        const replacement = { ...manifest, project: { ...manifest.project, name: 'Replacement' } };
        const allowed = testDependencies(
            root,
            sequenceFetch(
                jsonResponse(createResponse()),
                jsonResponse({ state: 'approved', expiresAt: expiry(), manifest: replacement }),
            ),
        );
        expect(await consoleCommand('link', { force: true }, allowed.dependencies)).toBe(0);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(replacement);
    });

    it('validates Console endpoints before prompting to replace a manifest', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const prompt = vi.fn(() => Promise.resolve(true));
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            env: { VENDURE_CONSOLE_LINK_URL: 'https://console.example.com' },
            isNonInteractive: () => false,
            prompt,
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(1);
        expect(prompt).not.toHaveBeenCalled();
        expect(test.messages.join('\n')).toContain('Set both VENDURE_CONSOLE_LINK_URL');
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('rethrows CliCommandExit from the prompt so the CLI host owns the exit', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            isNonInteractive: () => false,
            prompt: () => Promise.reject(new CliCommandExit(1)),
        });

        await expect(consoleCommand('link', {}, test.dependencies)).rejects.toBeInstanceOf(CliCommandExit);
        expect(test.messages.join('\n')).not.toContain('requested exit code');
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('leaves an existing manifest unchanged when interactive replacement is cancelled', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const test = testDependencies(root, fetchMock, {
            isNonInteractive: () => false,
            prompt: () => Promise.resolve(false),
        });

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('returns an interrupt exit code when the confirmation prompt is cancelled', async () => {
        const root = vendureProject();
        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const test = testDependencies(root, vi.fn() as unknown as typeof fetch, {
            isNonInteractive: () => false,
            prompt: () => Promise.resolve(undefined),
        });

        expect(await consoleCommand('unlink', {}, test.dependencies)).toBe(130);
        expect(fs.readJsonSync(getProjectLinkManifestPath(root))).toEqual(manifest);
    });

    it('reports linked, unlinked, and malformed status without network access', async () => {
        const root = vendureProject();
        const fetchMock = vi.fn() as unknown as typeof fetch;
        const unlinked = testDependencies(root, fetchMock);
        expect(await consoleCommand('status', {}, unlinked.dependencies)).toBe(0);
        expect(unlinked.messages.join('\n')).toContain('Project: Not linked');

        fs.ensureDirSync(path.dirname(getProjectLinkManifestPath(root)));
        fs.writeJsonSync(getProjectLinkManifestPath(root), manifest);
        const linked = testDependencies(root, fetchMock);
        expect(await consoleCommand('status', {}, linked.dependencies)).toBe(0);
        expect(linked.messages.join('\n')).toContain(`Account: Acme (${ACCOUNT_ID})`);
        expect(linked.messages.join('\n')).toContain(`Manifest: ${getProjectLinkManifestPath(root)}`);
        expect(linked.messages.join('\n')).toContain('Authentication: Not stored locally');

        fs.writeFileSync(getProjectLinkManifestPath(root), '{invalid');
        const malformed = testDependencies(root, fetchMock);
        expect(await consoleCommand('status', {}, malformed.dependencies)).toBe(1);
        expect(fetchMock).not.toHaveBeenCalled();
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
                jsonResponse(createResponse()),
                jsonResponse({ state: 'pending', expiresAt: expiry() }),
            ),
            {
                signal: externalAbort.signal,
                sleep: () => {
                    externalAbort.abort();
                    return Promise.resolve();
                },
            },
        );

        expect(await consoleCommand('link', {}, test.dependencies)).toBe(130);
        expect(fs.existsSync(getProjectLinkManifestPath(root))).toBe(false);
        expect(test.messages.join('\n')).toContain('No Project Link Manifest was changed');
    });
});

function testDependencies(
    root: string,
    fetchImplementation: typeof fetch,
    overrides: Partial<ConsoleCommandDependencies> = {},
): {
    dependencies: Partial<ConsoleCommandDependencies>;
    messages: string[];
    sleeps: number[];
    urls: string[];
} {
    const messages: string[] = [];
    const urls: string[] = [];
    const sleeps: number[] = [];
    let currentTime = NOW;
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
            env: {
                VENDURE_CLI_NON_INTERACTIVE: 'true',
                VENDURE_CONSOLE_LINK_URL: 'http://localhost:3000',
                VENDURE_CONSOLE_LINK_API_URL: 'http://localhost:3001',
            },
            fetch: fetchImplementation,
            isNonInteractive: () => true,
            now: () => currentTime,
            openUrl: () => Promise.resolve(),
            prompt: () => Promise.resolve(true),
            reporter,
            sleep: milliseconds => {
                sleeps.push(milliseconds);
                currentTime += milliseconds;
                return Promise.resolve();
            },
            ...overrides,
        },
        messages,
        sleeps,
        urls,
    };
}

function jsonResponse(value: unknown): Response {
    return new Response(JSON.stringify(value), {
        status: 200,
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
