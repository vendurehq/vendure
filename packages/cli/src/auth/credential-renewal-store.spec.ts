import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthOptions } from './auth-options.js';
import { writeStoredAuth } from './auth-store.js';
import { renewCredential } from './credential.js';

const NOW = Date.UTC(2026, 10, 25, 12);

/** An access token that is still valid for an hour. */
function accessToken(id: string): string {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'RS256' })}.${encode({ exp: Math.floor(NOW / 1000) + 3600, jti: id })}.signature`;
}

describe('renewCredential against a stored login', () => {
    let configDir: string;
    let options: AuthOptions;

    beforeEach(() => {
        configDir = mkdtempSync(path.join(tmpdir(), 'vendure-renewal-'));
        options = { env: { VENDURE_CLI_CONFIG_DIR: configDir }, now: () => NOW };
    });

    afterEach(() => rmSync(configDir, { recursive: true, force: true }));

    it('returns the token another request already renewed, without spending the refresh token', async () => {
        const renewed = accessToken('B');
        writeStoredAuth(
            {
                version: 1,
                consoleApiUrl: 'https://api.vendure.io',
                clientId: 'client_01PRODUCTION',
                workosApiHostname: 'api.workos.com',
                accessToken: renewed,
                refreshToken: 'refresh_2',
                user: { id: 'user_1', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace' },
                organization: null,
            },
            options,
        );
        const fetch = vi.fn();

        // The request sent A, which the stored login has already moved on from.
        const result = await renewCredential(
            { source: 'stored-login', token: accessToken('A') },
            { ...options, fetch },
        );

        expect(result).toEqual({ source: 'stored-login', token: renewed });
        expect(fetch).not.toHaveBeenCalled();
    });
});
