import { CommandContext, defineCommand } from '@vendure/common/lib/command';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { testCommand } from '../index.js';

import { createHostEnvironment } from './commander-adapter.js';

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

    it('renew from the token a request used, so a second refused request does not renew again', async () => {
        // The stored login as refreshAccessToken() treats it: a refused token that is no longer the
        // stored one gets the stored one back, without spending a refresh token.
        let stored = 'A';
        let spent = 0;
        const refreshed: string[] = [];
        const refreshCredential = async (failedToken: string) => {
            refreshed.push(failedToken);
            if (failedToken === stored) {
                spent++;
                stored = `${stored}'`;
            }
            return { source: 'stored-login' as const, token: stored };
        };
        const twoRequests = defineCommand({
            path: ['acme', 'two-requests'],
            description: 'Two requests',
            behavior: 'readonly',
            requires: { auth: 'cloud' },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx: CommandContext) => {
                    // Both requests were sent with A, and both were refused.
                    const first = await ctx.refreshCredential?.('A');
                    const second = await ctx.refreshCredential?.('A');
                    return { first: first?.token, second: second?.token, current: ctx.credential?.token };
                },
            }),
        });

        const result = await testCommand(
            twoRequests,
            {},
            { credential: { source: 'stored-login', token: 'A' }, refreshCredential },
        );

        expect(result.envelope.output).toEqual({ first: "A'", second: "A'", current: "A'" });
        expect(refreshed).toEqual(['A', 'A']);
        expect(spent).toBe(1);
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
