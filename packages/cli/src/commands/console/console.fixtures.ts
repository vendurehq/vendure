import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { ProjectLinkManifest } from './project-link-manifest';

export const NOW = Date.parse('2026-08-19T10:00:00.000Z');
export const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
export const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
export const LINK_ID = '33333333-3333-4333-8333-333333333333';
export const OTHER_LINK_ID = '44444444-4444-4444-8444-444444444444';
export const POLLING_SECRET = 'one-time-polling-secret';
export const ACCESS_TOKEN = 'vcli_access-token';
export const REFRESH_TOKEN = 'vclr_refresh-token';

export const manifest: ProjectLinkManifest = {
    schemaVersion: 1,
    project: { id: PROJECT_ID, name: 'Storefront' },
    account: { id: ACCOUNT_ID, name: 'Acme' },
    link: { id: LINK_ID, protocolVersion: 1 },
};

export function expiry(): string {
    return new Date(NOW + 10 * 60 * 1_000).toISOString();
}

export function createResponse(expiresAt = expiry()) {
    return {
        id: LINK_ID,
        state: 'pending',
        protocolVersion: 1,
        expiresAt,
        pollingSecret: POLLING_SECRET,
        verificationPath: `/?link=${LINK_ID}`,
    };
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

export function createConsoleFetch(
    options: {
        supports?: string[];
        tokenStatus?: number;
        tokenBody?: unknown;
        onTokenRequest?: () => void;
        grants?: Array<Record<string, string>>;
        verificationPath?: string;
    } = {},
) {
    return async (input: string, init?: RequestInit): Promise<Response> => {
        const url = new URL(input);
        if (url.pathname === '/v1/project-links') {
            return jsonResponse({
                ...createResponse(),
                verificationPath: options.verificationPath ?? `/?link=${LINK_ID}`,
                ...(options.supports ? { supports: options.supports } : {}),
            });
        }
        if (url.pathname.endsWith('/poll')) {
            return jsonResponse({ state: 'approved', expiresAt: expiry(), manifest });
        }
        if (url.pathname === '/v1/auth/cli/token') {
            options.onTokenRequest?.();
            options.grants?.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, string>);
            if ((options.tokenStatus ?? 200) !== 200) {
                return jsonResponse({}, options.tokenStatus);
            }
            return jsonResponse(
                options.tokenBody ?? {
                    access_token: ACCESS_TOKEN,
                    token_type: 'Bearer',
                    expires_in: 3600,
                    refresh_token: REFRESH_TOKEN,
                },
            );
        }
        throw new Error(`Unexpected request to ${input}`);
    };
}
