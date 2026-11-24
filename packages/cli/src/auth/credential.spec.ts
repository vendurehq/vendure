import { isIncompleteResult } from '@vendure/common/lib/command';
import fs from 'fs-extra';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthOptions } from './auth-options.js';
import { writeStoredAuth } from './auth-store.js';
import { requireCredential } from './credential.js';

let configDir: string;
let options: AuthOptions;

const accessToken = `e30.${Buffer.from(JSON.stringify({ exp: 4_102_444_800 })).toString('base64url')}.sig`;

function storeLogin() {
    writeStoredAuth(
        {
            version: 1,
            consoleApiUrl: 'https://api.vendure.io',
            clientId: 'client_01PRODUCTION',
            workosApiHostname: 'api.workos.com',
            accessToken,
            refreshToken: 'refresh_secret',
            user: { id: 'user_01', email: 'dev@example.com', firstName: 'Ada', lastName: null },
            organization: {
                workosOrganizationId: 'org_1',
                customerAccountId: '11111111-1111-4111-8111-111111111111',
                name: 'Bromley Art Supplies',
            },
        },
        options,
    );
}

beforeEach(() => {
    configDir = mkdtempSync(path.join(tmpdir(), 'vendure-credential-'));
    options = {
        env: { VENDURE_CLI_CONFIG_DIR: configDir },
        fetch: () => Promise.reject(new Error('no network in tests')),
    };
});

afterEach(() => {
    fs.removeSync(configDir);
});

describe('requireCredential', () => {
    it('uses the stored login first, even when VENDURE_CLOUD_TOKEN is set', async () => {
        storeLogin();

        const credential = await requireCredential({
            ...options,
            env: { ...options.env, VENDURE_CLOUD_TOKEN: 'vcdk_agent' },
            mayPrompt: false,
        });

        expect(credential).toEqual({ source: 'stored-login', token: accessToken });
    });

    it('uses VENDURE_CLOUD_TOKEN when no login is stored', async () => {
        const credential = await requireCredential({
            ...options,
            env: { ...options.env, VENDURE_CLOUD_TOKEN: ' vcdk_agent ' },
            mayPrompt: false,
        });

        expect(credential).toEqual({ source: 'environment', token: 'vcdk_agent' });
    });

    it('uses VENDURE_CLOUD_TOKEN when the stored login is for another organization', async () => {
        storeLogin();

        const credential = await requireCredential({
            ...options,
            env: { ...options.env, VENDURE_CLOUD_TOKEN: 'vcdk_agent' },
            organization: 'Example GmbH',
            mayPrompt: false,
        });

        expect(credential).toMatchObject({ source: 'environment' });
    });

    it('returns an input need for the secret token, and never signs in, when nobody may be asked', async () => {
        const signIn = vi.fn(() => Promise.resolve());

        const result = await requireCredential({ ...options, mayPrompt: false, signIn });

        expect(signIn).not.toHaveBeenCalled();
        expect(isIncompleteResult(result)).toBe(true);
        expect(result).toMatchObject({
            needs: [
                {
                    kind: 'input',
                    field: 'token',
                    secret: true,
                    fix: { path: ['auth', 'login'], input: { json: true } },
                },
            ],
        });
    });

    it('signs a person in when it may ask, and uses the new login', async () => {
        const signIn = vi.fn(() => {
            storeLogin();
            return Promise.resolve();
        });

        const credential = await requireCredential({ ...options, mayPrompt: true, signIn });

        expect(signIn).toHaveBeenCalledOnce();
        expect(credential).toEqual({ source: 'stored-login', token: accessToken });
    });

    it('treats a blank VENDURE_CLOUD_TOKEN as unset', async () => {
        const result = await requireCredential({
            ...options,
            env: { ...options.env, VENDURE_CLOUD_TOKEN: '  ' },
            mayPrompt: false,
        });

        expect(isIncompleteResult(result)).toBe(true);
    });
});
