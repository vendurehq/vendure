import fs from 'fs-extra';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readStoredAuth, writeStoredAuth } from '../../auth/auth-store';

import { AuthCommandDependencies, authLoginCommand, authLogoutCommand, authStatusCommand } from './auth';

let configDir: string;
let messages: string[];
let stdout: string[];
let dependencies: Partial<AuthCommandDependencies>;

const accessToken = `e30.${Buffer.from(JSON.stringify({ exp: 4_102_444_800 })).toString('base64url')}.sig`;

function storeLogin(consoleApiUrl = 'https://api.vendure.io') {
    writeStoredAuth(
        {
            version: 1,
            consoleApiUrl,
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
        dependencies,
    );
}

beforeEach(() => {
    configDir = mkdtempSync(path.join(tmpdir(), 'vendure-auth-command-'));
    messages = [];
    stdout = [];
    const record = (message: string) => messages.push(message);
    dependencies = {
        env: { VENDURE_CLI_CONFIG_DIR: configDir },
        reporter: { error: record, info: record, success: record, warn: record },
        isNonInteractive: () => true,
        writeStdout: value => stdout.push(value),
        fetch: () => Promise.reject(new Error('no network in tests')),
    };
});

afterEach(() => {
    fs.removeSync(configDir);
});

describe('vendure auth status', () => {
    it('exits 1 when not logged in', () => {
        expect(authStatusCommand({}, dependencies)).toBe(1);
        expect(messages.join('\n')).toContain('vendure auth login');
    });

    it('prints the login as JSON without tokens', () => {
        storeLogin();

        expect(authStatusCommand({ json: true }, dependencies)).toBe(0);
        const status = JSON.parse(stdout.join(''));
        expect(status).toMatchObject({
            loggedIn: true,
            organization: { name: 'Bromley Art Supplies' },
            user: { email: 'dev@example.com' },
            consoleApiUrl: 'https://api.vendure.io',
            clientId: 'client_01PRODUCTION',
        });
        expect(stdout.join('')).not.toContain('refresh_secret');
        expect(stdout.join('')).not.toContain(accessToken);
    });

    it('points out a login stored for another Vendure Console', () => {
        storeLogin('https://staging.api.vendure.io');

        expect(authStatusCommand({}, dependencies)).toBe(1);
        expect(messages.join('\n')).toContain('VENDURE_CONSOLE_API_URL');
    });

    it('shows the organization name and Account identifier in status', () => {
        storeLogin();

        expect(authStatusCommand({}, dependencies)).toBe(0);
        expect(messages.join('\n')).toContain(
            'Bromley Art Supplies (Account identifier 11111111-1111-4111-8111-111111111111)',
        );
    });
});

describe('vendure auth login', () => {
    it('refuses an unknown Console API before the browser step', async () => {
        const code = await authLoginCommand(
            { organization: 'Acme' },
            {
                ...dependencies,
                env: { ...dependencies.env, VENDURE_CONSOLE_API_URL: 'https://attacker.example.com' },
            },
        );

        expect(code).toBe(1);
        expect(messages.join('\n')).toContain('is not a Vendure Console API');
    });

    it('keeps the existing login when the user declines to replace it', async () => {
        storeLogin();

        const code = await authLoginCommand(
            {},
            { ...dependencies, isNonInteractive: () => false, confirm: () => Promise.resolve(false) },
        );

        expect(code).toBe(0);
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    it('reports a failure to reach Vendure Console', async () => {
        await expect(authLoginCommand({}, dependencies)).resolves.toBe(1);
        expect(messages.join('\n')).toContain('Could not reach Vendure Console at https://api.vendure.io.');
    });
});

describe('vendure auth logout', () => {
    it('ends the session, removes the login and says so', async () => {
        storeLogin();
        const fetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof globalThis.fetch;

        await expect(authLogoutCommand({ ...dependencies, fetch })).resolves.toBe(0);
        expect(readStoredAuth(dependencies)).toBeUndefined();
        expect(messages).toEqual([
            'Logged out. The session was ended and the login removed from this machine.',
        ]);
    });

    it('warns that copies keep working when Console cannot end the session', async () => {
        storeLogin();

        await expect(authLogoutCommand(dependencies)).resolves.toBe(0);
        expect(readStoredAuth(dependencies)).toBeUndefined();
        expect(messages).toEqual([
            'Logged out. The login was removed from this machine.',
            'Vendure Console could not end the session, so a copy of this login keeps working until it expires.',
        ]);
    });
});
