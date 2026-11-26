import { CommandContext, defineCommand } from '@vendure/common/lib/command';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { testCommand } from '../index.js';

import { createHostEnvironment } from './commander-adapter.js';
import { runInTestHost } from './test-command.js';

/** Calls the Console as a Cloud command would: renews once after a refused request. */
const call = defineCommand({
    path: ['acme', 'call'],
    description: 'Call',
    behavior: 'readonly',
    requires: { auth: 'cloud' },
    schemas: async () => ({ input: z.object({}) }),
    run: async () => ({
        run: async (_input: object, ctx: CommandContext) => {
            const first = ctx.credential?.token;
            const renewed = await ctx.refreshCredential?.();
            return {
                first,
                renewed: renewed?.token ?? null,
                current: ctx.credential?.token,
                account: ctx.account ?? null,
            };
        },
    }),
});

describe('ctx.refreshCredential and ctx.account', () => {
    it('renew the credential, which also replaces ctx.credential', async () => {
        const result = await testCommand(
            call,
            {},
            {
                credential: { source: 'stored-login', token: 'first' },
                refreshCredential: async () => ({ source: 'stored-login', token: 'second' }),
            },
        );

        expect(result.envelope.output).toMatchObject({
            first: 'first',
            renewed: 'second',
            current: 'second',
        });
    });

    it('pass on the token each refused request used', async () => {
        const refreshed: string[] = [];
        const twoRequests = defineCommand({
            path: ['acme', 'two-requests'],
            description: 'Two requests',
            behavior: 'readonly',
            requires: { auth: 'cloud' },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx: CommandContext) => {
                    // Both requests were sent with A, and both were refused. The second renewal
                    // still names A, so the login can tell it was renewed already.
                    await ctx.refreshCredential?.('A');
                    await ctx.refreshCredential?.('A');
                    return {};
                },
            }),
        });

        await testCommand(
            twoRequests,
            {},
            {
                credential: { source: 'stored-login', token: 'A' },
                refreshCredential: async failedToken => {
                    refreshed.push(failedToken);
                    return { source: 'stored-login', token: 'B' };
                },
            },
        );

        expect(refreshed).toEqual(['A', 'A']);
    });

    it('report a renewal that failed for a reason that may pass as auth.credential-failed', async () => {
        const result = await testCommand(
            call,
            {},
            {
                credential: { source: 'stored-login', token: 'first' },
                refreshCredential: () =>
                    Promise.reject(new Error('Could not reach the authentication service')),
            },
        );

        expect(result.envelope).toMatchObject({
            status: 'error',
            error: {
                code: 'auth.credential-failed',
                message: expect.stringContaining('Could not reach the authentication service'),
            },
        });
    });

    it('bring ctx.account up to date after a renewal', async () => {
        const organization = (token: string) => ({ id: token, customerAccountId: null, name: null });
        const result = await runInTestHost(
            call,
            {},
            {},
            {
                requireCredential: async () => ({ credential: { source: 'stored-login', token: 'first' } }),
                refreshCredential: async () => ({ source: 'stored-login', token: 'second' }),
                describeAccount: (_kind, credential) => ({
                    apiUrl: 'https://api.vendure.io',
                    organization: organization(credential.token),
                }),
            },
        );

        expect(result.envelope.output).toMatchObject({ account: { organization: { id: 'second' } } });
    });

    it('renew from the current credential when no token is given', async () => {
        const refreshed: string[] = [];

        await testCommand(
            call,
            {},
            {
                credential: { source: 'stored-login', token: 'first' },
                refreshCredential: async failedToken => {
                    refreshed.push(failedToken);
                    return { source: 'stored-login', token: 'second' };
                },
            },
        );

        expect(refreshed).toEqual(['first']);
    });

    it('give nothing when the credential cannot be renewed, and keep the one there is', async () => {
        const result = await testCommand(call, {}, { credential: { source: 'environment', token: 'vcdk' } });

        expect(result.envelope.output).toMatchObject({ renewed: null, current: 'vcdk', account: null });
    });

    it('pass the account through', async () => {
        const account = { consoleUrl: 'https://console.vendure.io', apiUrl: 'https://api.vendure.io' };

        const result = await testCommand(
            call,
            {},
            { credential: { source: 'environment', token: 'vcdk' }, account },
        );

        expect(result.envelope.output).toMatchObject({ account });
    });

    it('are not set for a command without requires.auth', async () => {
        const local = defineCommand({
            path: ['acme', 'local'],
            description: 'Local',
            behavior: 'readonly',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx: CommandContext) => ({
                    refresh: typeof ctx.refreshCredential,
                    account: ctx.account ?? null,
                }),
            }),
        });

        const result = await testCommand(local, {});

        expect(result.envelope.output).toEqual({ refresh: 'undefined', account: null });
    });
});

describe('the CLI host environment', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('cannot renew VENDURE_CLOUD_TOKEN, and names the Console it belongs to', async () => {
        vi.stubEnv('VENDURE_CONSOLE_API_URL', 'https://staging.api.vendure.io');
        const env = createHostEnvironment(new AbortController());
        const credential = { source: 'environment', token: 'vcdk' } as const;

        await expect(
            env.refreshCredential?.('cloud', credential, {
                signal: new AbortController().signal,
            } as CommandContext),
        ).resolves.toBeUndefined();
        expect(env.describeAccount?.('cloud', credential)).toEqual({
            consoleUrl: 'https://staging.console.vendure.io',
            apiUrl: 'https://staging.api.vendure.io',
        });
    });
});
