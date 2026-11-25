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
