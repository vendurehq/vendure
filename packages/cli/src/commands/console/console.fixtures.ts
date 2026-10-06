import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { StoredAuth, writeStoredAuth } from '../../auth/auth-store';

import { ProjectLinkManifest } from './project-link-manifest';

export const NOW = Date.parse('2026-08-19T10:00:00.000Z');
export const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
export const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
export const LINK_ID = '33333333-3333-4333-8333-333333333333';
export const OTHER_LINK_ID = '44444444-4444-4444-8444-444444444444';
export const OTHER_PROJECT_ID = '55555555-5555-4555-8555-555555555555';
export const OTHER_ACCOUNT_ID = '66666666-6666-4666-8666-666666666666';
export const ORGANIZATION_ID = 'org_acme';
export const OTHER_ORGANIZATION_ID = 'org_other';
export const CLIENT_ID = 'client_01CONSOLE';
export const WORKOS_AUTHENTICATE_URL = 'https://api.workos.com/user_management/authenticate';
export const WORKOS_DEVICE_AUTHORIZE_URL = 'https://api.workos.com/user_management/authorize/device';
export const USER = { id: 'user_01', email: 'dev@example.com', first_name: 'Ada', last_name: 'Lovelace' };
export const STORED_REFRESH_TOKEN = 'stored-refresh-token';

export const manifest: ProjectLinkManifest = {
    schemaVersion: 1,
    project: { id: PROJECT_ID, name: 'Storefront' },
    account: { id: ACCOUNT_ID, name: 'Acme' },
    link: { id: LINK_ID, protocolVersion: 1 },
};

/** A WorkOS access token that expires `seconds` after NOW. The CLI reads its claims without verifying them. */
export function accessToken(name: string, organizationId = ORGANIZATION_ID, seconds = 3600): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const claims = { sub: USER.id, org_id: organizationId, exp: Math.floor(NOW / 1000) + seconds, name };
    return `${encode({ alg: 'RS256' })}.${encode(claims)}.signature`;
}

export const STORED_ACCESS_TOKEN = accessToken('stored');

/** Writes a `vendure auth login` for `consoleApiUrl` into the CLI config directory that `env` names. */
export function storeLogin(
    env: NodeJS.ProcessEnv,
    consoleApiUrl: string,
    overrides: Partial<StoredAuth> = {},
): void {
    writeStoredAuth(
        {
            version: 1,
            consoleApiUrl,
            clientId: CLIENT_ID,
            workosApiHostname: 'api.workos.com',
            accessToken: STORED_ACCESS_TOKEN,
            refreshToken: STORED_REFRESH_TOKEN,
            user: { id: USER.id, email: USER.email, firstName: USER.first_name, lastName: USER.last_name },
            organization: {
                workosOrganizationId: ORGANIZATION_ID,
                customerAccountId: ACCOUNT_ID,
                name: 'Acme',
            },
            ...overrides,
        },
        { env: { ...env, VENDURE_CONSOLE_API_URL: consoleApiUrl } },
    );
}

/** A temporary CLI config directory, so a test never reads or writes the real login. */
export function createCliConfigDir(temporaryDirectories: string[]): string {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-console-auth-')));
    temporaryDirectories.push(directory);
    return directory;
}

/** Console's `GET /v1/projects`, trimmed to the fields the CLI reads plus one it ignores. */
export function projectList(
    projects: Array<{ id: string; name: string; state?: string }> = [{ id: PROJECT_ID, name: 'Storefront' }],
): unknown[] {
    return projects.map(project => ({ state: 'active', slug: project.name.toLowerCase(), ...project }));
}

export function createVendureProject(temporaryDirectories: string[], prefix: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    temporaryDirectories.push(root);
    fs.writeJsonSync(path.join(root, 'package.json'), {
        dependencies: { '@vendure/core': '3.7.2' },
    });
    return root;
}

export function jsonResponse(value: unknown, status = 200): Response {
    return new Response(JSON.stringify(value), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

export interface RecordedRequest {
    method: string;
    url: string;
    authorization?: string;
    body: Record<string, string>;
}

export interface FakeConsoleOptions {
    /** Console's `GET /v1/projects`. */
    projects?: unknown[];
    /** The Customer Accounts in Console's `GET /v1/me`. */
    memberships?: Array<{ organizationId: string; customerAccountId: string; name: string }>;
    /** The organization the device login's token is scoped to, before any `--organization` re-scope. */
    deviceOrganizationId?: string;
    /** Answers a refresh grant. Defaults to a new token pair for the requested organization. */
    refresh?: (body: Record<string, string>) => Response;
    /** Answers `POST /v1/projects/:id/link`. Defaults to the manifest for that project. */
    link?: (projectId: string, authorization: string | undefined) => Response;
}

/**
 * An in-memory Vendure Console and WorkOS. It answers the device login, the
 * refresh grant, the organization lookup, the project list and the link, and
 * records every request. Anything else fails the test.
 */
export function fakeConsole(options: FakeConsoleOptions = {}) {
    const requests: RecordedRequest[] = [];
    let issued = 0;
    const tokens = (organizationId: string | undefined) => {
        issued++;
        return jsonResponse({
            access_token: accessToken(`issued-${issued}`, organizationId),
            refresh_token: `issued-refresh-${issued}`,
            user: USER,
            ...(organizationId ? { organization_id: organizationId } : {}),
        });
    };
    const fetch = async (input: string | URL, init: RequestInit = {}): Promise<Response> => {
        const url = new URL(String(input));
        const method = init.method ?? 'GET';
        const headers = (init.headers ?? {}) as Record<string, string>;
        const raw = typeof init.body === 'string' ? init.body : undefined;
        const body: Record<string, string> =
            raw === undefined
                ? {}
                : url.href === WORKOS_DEVICE_AUTHORIZE_URL
                  ? Object.fromEntries(new URLSearchParams(raw))
                  : (JSON.parse(raw) as Record<string, string>);
        requests.push({
            method,
            url: url.href,
            ...(headers.Authorization ? { authorization: headers.Authorization } : {}),
            body,
        });
        if (url.href === WORKOS_DEVICE_AUTHORIZE_URL) {
            return jsonResponse({
                device_code: 'device_1',
                user_code: 'ABCD-EFGH',
                verification_uri: 'https://auth.example.com/device',
                verification_uri_complete: 'https://auth.example.com/device?code=ABCD-EFGH',
                expires_in: 300,
                interval: 0.001,
            });
        }
        if (url.href === WORKOS_AUTHENTICATE_URL) {
            if (body.grant_type === 'refresh_token') {
                return options.refresh?.(body) ?? tokens(body.organization_id);
            }
            return tokens(options.deviceOrganizationId ?? ORGANIZATION_ID);
        }
        if (method === 'GET' && url.pathname === '/v1') {
            return jsonResponse({
                service: 'api',
                authentication: { provider: 'workos', clientId: CLIENT_ID, apiHostname: 'api.workos.com' },
            });
        }
        if (method === 'GET' && url.pathname === '/v1/me') {
            const memberships = options.memberships ?? [
                { organizationId: ORGANIZATION_ID, customerAccountId: ACCOUNT_ID, name: 'Acme' },
            ];
            return jsonResponse({
                user: { id: USER.id },
                memberships: memberships.map(membership => ({ ...membership, status: 'active' })),
            });
        }
        if (method === 'GET' && url.pathname === '/v1/projects') {
            return jsonResponse(options.projects ?? projectList());
        }
        const link = /^\/v1\/projects\/([^/]+)\/link$/.exec(url.pathname);
        if (method === 'POST' && link) {
            const projectId = decodeURIComponent(link[1]);
            return (
                options.link?.(projectId, headers.Authorization) ??
                jsonResponse({ ...manifest, project: { ...manifest.project, id: projectId } })
            );
        }
        throw new Error(`Unexpected request to ${method} ${url.href}`);
    };
    return { fetch: fetch as typeof globalThis.fetch, requests };
}
