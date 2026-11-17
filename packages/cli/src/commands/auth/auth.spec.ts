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
const renewedAccessToken = `e30.${Buffer.from(JSON.stringify({ exp: 4_102_448_400 })).toString('base64url')}.sig`;
const AUTHENTICATE_URL = 'https://api.workos.com/user_management/authenticate';

/** Answers the refresh token grant with `answer` and fails every other request as unreachable. */
function renewalAnswers(answer: { status: number; body: unknown }): typeof globalThis.fetch {
    return ((url: string) => {
        if (url !== AUTHENTICATE_URL) {
            return Promise.reject(new Error('no network in tests'));
        }
        return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
    }) as typeof globalThis.fetch;
}

const RENEWED = {
    status: 200,
    body: {
        access_token: renewedAccessToken,
        refresh_token: 'refresh_renewed',
        user: { id: 'user_01', email: 'dev@example.com', first_name: 'Ada', last_name: null },
        organization_id: 'org_1',
    },
};
const INVALID_GRANT = { status: 400, body: { error: 'invalid_grant' } };
const INVALID_CLIENT = { status: 400, body: { error: 'invalid_client' } };

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
    it('exits 1 when not logged in', async () => {
        await expect(authStatusCommand({}, dependencies)).resolves.toBe(1);
        expect(messages.join('\n')).toContain('vendure auth login');
    });

    it('prints the login as JSON without tokens', async () => {
        storeLogin();

        await expect(
            authStatusCommand({ json: true }, { ...dependencies, fetch: renewalAnswers(RENEWED) }),
        ).resolves.toBe(0);
        const status = JSON.parse(stdout.join(''));
        expect(status).toMatchObject({
            loggedIn: true,
            organization: { name: 'Bromley Art Supplies' },
            user: { email: 'dev@example.com' },
            consoleApiUrl: 'https://api.vendure.io',
            clientId: 'client_01PRODUCTION',
            renewable: true,
        });
        expect(stdout.join('')).not.toContain('refresh_secret');
        expect(stdout.join('')).not.toContain('refresh_renewed');
        expect(stdout.join('')).not.toContain(accessToken);
        expect(stdout.join('')).not.toContain(renewedAccessToken);
    });

    it('points out a login stored for another Vendure Console', async () => {
        storeLogin('https://staging.api.vendure.io');

        await expect(authStatusCommand({}, dependencies)).resolves.toBe(1);
        expect(messages.join('\n')).toContain('VENDURE_CONSOLE_API_URL');
    });

    it('shows the organization name and Account identifier in status', async () => {
        storeLogin();

        await expect(
            authStatusCommand({}, { ...dependencies, fetch: renewalAnswers(RENEWED) }),
        ).resolves.toBe(0);
        expect(messages.join('\n')).toContain(
            'Bromley Art Supplies (Account identifier 11111111-1111-4111-8111-111111111111)',
        );
    });

    // OSS-930: a stored login that can no longer be renewed was reported as logged in.
    it('renews the login and reports it as logged in', async () => {
        storeLogin();

        await expect(
            authStatusCommand({}, { ...dependencies, fetch: renewalAnswers(RENEWED) }),
        ).resolves.toBe(0);
        expect(messages.join('\n')).toContain('Logged in as Ada <dev@example.com>');
        expect(messages.join('\n')).toContain('Authentication client: client_01PRODUCTION');
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_renewed');
    });

    it('reports a refresh token the authentication service refused, with its code', async () => {
        storeLogin();

        await expect(
            authStatusCommand({}, { ...dependencies, fetch: renewalAnswers(INVALID_GRANT) }),
        ).resolves.toBe(1);
        expect(messages).toEqual([
            'The stored login for dev@example.com can no longer be renewed (invalid_grant, HTTP 400). ' +
                'Run `vendure auth login` to sign in again.',
        ]);
        expect(readStoredAuth(dependencies)).toBeUndefined();
    });

    it('reports a renewal refused for another reason and keeps the login', async () => {
        storeLogin();

        await expect(
            authStatusCommand({ json: true }, { ...dependencies, fetch: renewalAnswers(INVALID_CLIENT) }),
        ).resolves.toBe(1);
        expect(JSON.parse(stdout.join(''))).toMatchObject({
            loggedIn: false,
            renewable: false,
            renewalError: { code: 'invalid_client', status: 400 },
            user: { email: 'dev@example.com' },
        });
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    // CLO-1083: the renewal fails with token_too_big while the user holds too many roles.
    it('says what to do when the renewed token would be too big', async () => {
        storeLogin();

        await expect(
            authStatusCommand(
                {},
                { ...dependencies, fetch: renewalAnswers({ status: 400, body: { error: 'token_too_big' } }) },
            ),
        ).resolves.toBe(1);
        expect(messages).toEqual([
            'The stored login for dev@example.com can no longer be renewed (token_too_big, HTTP 400). ' +
                'Your account holds too many roles in the organization for a sign-in token. ' +
                'Ask an organization admin to remove the roles you do not need from your membership, then try again. ' +
                'Run `vendure auth login` to sign in again.',
        ]);
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    it('reports the login and warns when the renewal cannot be checked', async () => {
        storeLogin();

        await expect(authStatusCommand({}, dependencies)).resolves.toBe(0);
        expect(messages[0]).toContain('Logged in as Ada <dev@example.com>');
        expect(messages[1]).toBe(
            'Could not check that the login can be renewed: ' +
                'Could not reach the authentication service to renew your CLI session.',
        );
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    it('does not name the identity provider', async () => {
        storeLogin();

        await authStatusCommand({}, { ...dependencies, fetch: renewalAnswers(RENEWED) });
        await authStatusCommand({}, { ...dependencies, fetch: renewalAnswers(INVALID_CLIENT) });

        expect(messages.join('\n')).not.toMatch(/workos/i);
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
        const prompts: string[] = [];

        const code = await authLoginCommand(
            {},
            {
                ...dependencies,
                fetch: renewalAnswers(RENEWED),
                isNonInteractive: () => false,
                confirm: message => {
                    prompts.push(message);
                    return Promise.resolve(false);
                },
            },
        );

        expect(code).toBe(0);
        expect(prompts).toEqual(['Already logged in as dev@example.com. Sign in again?']);
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_renewed');
    });

    it('asks before replacing a login whose renewal cannot be checked, and says so', async () => {
        storeLogin();
        const prompts: string[] = [];

        const code = await authLoginCommand(
            {},
            {
                ...dependencies,
                isNonInteractive: () => false,
                confirm: message => {
                    prompts.push(message);
                    return Promise.resolve(false);
                },
            },
        );

        expect(code).toBe(0);
        expect(prompts).toHaveLength(1);
        expect(messages[0]).toBe(
            'Could not check that the stored login can be renewed: ' +
                'Could not reach the authentication service to renew your CLI session.',
        );
        expect(readStoredAuth(dependencies)?.refreshToken).toBe('refresh_secret');
    });

    // OSS-930: `vendure auth login` asked "Already logged in" for a login that could no longer be renewed.
    it.each([
        ['invalid_grant', INVALID_GRANT],
        ['invalid_client', INVALID_CLIENT],
    ])('goes straight to sign-in when the renewal is refused with %s', async (code, answer) => {
        storeLogin();
        const prompts: string[] = [];

        await authLoginCommand(
            {},
            {
                ...dependencies,
                fetch: renewalAnswers(answer),
                isNonInteractive: () => false,
                confirm: message => {
                    prompts.push(message);
                    return Promise.resolve(false);
                },
            },
        );

        expect(prompts).toEqual([]);
        expect(messages[0]).toBe(
            `The stored login for dev@example.com can no longer be renewed (${code}, HTTP 400). Signing in again.`,
        );
        // The sign-in itself starts at Vendure Console, which is unreachable here.
        expect(messages[1]).toContain('Could not reach Vendure Console at https://api.vendure.io.');
        expect(messages.join('\n')).not.toMatch(/workos/i);
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
