import {
    applyCommandExtensions,
    CommandContext,
    defineCommand,
    defineCommandExtension,
    defineError,
    fail,
    incomplete,
} from '@vendure/common/lib/command';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { executeWithCancellation } from './commander-adapter.js';
import { consentDigest } from './digest.js';
import { HostEnvironment } from './host.js';
import { testCommand } from './test-command.js';

const received: Array<Record<string, unknown>> = [];

const deploy = defineCommand({
    path: ['acme', 'deploy'],
    description: 'Deploy',
    behavior: 'mutating',
    cli: { fields: { trace: { internal: true } } },
    schemas: async () => ({
        input: z.object({ environment: z.string().default('staging'), trace: z.string().optional() }),
        output: z.object({ deployed: z.string() }),
    }),
    run: async () => ({
        run: async (input: Record<string, unknown>) => {
            received.push(input);
            return { deployed: String(input.environment) };
        },
    }),
});

const notLinked = defineError<Record<string, never>>({
    code: 'cloud.not-linked',
    exit: 1,
    message: () => 'This project is not linked',
});

function cloud(run: (input: any, ctx: CommandContext, next: any) => Promise<any>) {
    return defineCommandExtension({
        path: ['acme', 'deploy'],
        consents: { deployProduction: 'Deploy to production' },
        errors: [notLinked],
        schemas: async () => ({
            input: z.object({ project: z.string().describe('The Console Project') }),
            output: z.object({ previewUrl: z.string().optional() }),
        }),
        run: async () => ({ run }),
    });
}

describe('an extended command through the host', () => {
    afterEach(() => {
        received.length = 0;
    });

    it("asks for an extension's missing field, as for the command's own", async () => {
        const extended = applyCommandExtensions(deploy, [cloud((_input, _ctx, next) => next())]);

        const result = await testCommand(extended, {});

        expect(result.envelope).toMatchObject({
            status: 'incomplete',
            needs: [{ kind: 'input', field: 'project' }],
        });
    });

    it('reports a declared error of the extension', async () => {
        const extended = applyCommandExtensions(deploy, [cloud(async () => fail(notLinked, {}))]);

        const result = await testCommand(extended, { project: 'storefront' });

        expect(result.envelope.error?.code).toBe('cloud.not-linked');
    });

    it("asks for an extension's consent through ctx.consent, also when it calls next() again", async () => {
        const extended = applyCommandExtensions(deploy, [
            cloud(async (_input, ctx, next) => {
                // Two tries, as a retry loop does, each asking for the same consent and preview.
                for (let attempt = 0; attempt < 2; attempt++) {
                    const answer = await ctx.consent('deployProduction', { environment: 'production' });
                    if (answer !== true) {
                        return incomplete([answer]);
                    }
                    await next({ environment: 'production' });
                }
                return next({ environment: 'production' });
            }),
        ]);

        const first = await testCommand(extended, { project: 'storefront' });
        expect(first.envelope).toMatchObject({
            status: 'incomplete',
            needs: [{ kind: 'consent', consent: 'deployProduction' }],
        });

        const digest = consentDigest('deployProduction', { environment: 'production' });
        const second = await testCommand(extended, { project: 'storefront', deployProduction: digest });
        expect(second.envelope).toMatchObject({ status: 'ok', output: { deployed: 'production' } });
        expect(received).toHaveLength(3);
    });

    it('removes an internal field from what a caller passes, and lets the extension set it', async () => {
        const extended = applyCommandExtensions(deploy, [
            cloud((input, _ctx, next) => next(input.project === 'traced' ? { trace: 'cloud' } : undefined)),
        ]);

        await testCommand(extended, { project: 'plain', trace: 'from the caller' });
        await testCommand(extended, { project: 'traced', trace: 'from the caller' });

        expect(received).toEqual([{ environment: 'staging' }, { environment: 'staging', trace: 'cloud' }]);
    });

    it("runs the command's transforms once, on the caller's values, with and without changes", async () => {
        const ran: Array<Record<string, unknown>> = [];
        const tag = defineCommand({
            path: ['acme', 'tag'],
            description: 'Tag',
            behavior: 'readonly',
            schemas: async () => ({
                input: z.object({
                    name: z.string().transform(name => `${name}!`),
                    note: z.string().optional(),
                }),
            }),
            run: async () => ({
                run: async (input: Record<string, unknown>) => {
                    ran.push(input);
                    return {};
                },
            }),
        });
        const noted = defineCommandExtension({
            path: ['acme', 'tag'],
            schemas: async () => ({ input: z.object({ addNote: z.boolean().default(false) }) }),
            run: async () => ({
                run: async (input, _ctx, next) =>
                    input.addNote ? next({ note: 'from the extension' }) : next(),
            }),
        });
        const extended = applyCommandExtensions(tag, [noted]);

        await testCommand(extended, { name: 'release' });
        await testCommand(extended, { name: 'release', addNote: true });

        expect(ran).toEqual([{ name: 'release!' }, { name: 'release!', note: 'from the extension' }]);
    });

    it('ends the run with cli.internal when the changes an extension gives next() are not valid', async () => {
        const extended = applyCommandExtensions(deploy, [
            cloud((_input, _ctx, next) => next({ environment: 42 })),
        ]);

        const result = await testCommand(extended, { project: 'storefront' });

        expect(result.envelope.error).toMatchObject({
            code: 'cli.internal',
            message: expect.stringContaining('gave next() is not valid'),
        });
    });
});

describe('executeWithCancellation', () => {
    afterEach(() => vi.useRealTimers());

    function environment(controller: AbortController): HostEnvironment {
        return {
            cwd: '/project',
            signal: controller.signal,
            mcp: false,
            emit: () => undefined,
            spawn: () => Promise.reject(new Error('no processes')),
            findProjectRoot: () => '/project',
        };
    }

    /** A command that stops 20 seconds after it is cancelled, as a service that winds down does. */
    function slowToStop(behavior: 'service' | 'mutating', stopsAfter = 20_000) {
        return defineCommand({
            path: ['acme', 'serve'],
            description: 'Serve',
            behavior,
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: unknown, ctx: CommandContext) => {
                    await new Promise<void>(resolve =>
                        ctx.signal.addEventListener('abort', () => setTimeout(resolve, stopsAfter)),
                    );
                    return { stopped: true };
                },
            }),
        });
    }

    it('gives a service command up to 30 seconds to stop, so its finally blocks run', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const running = executeWithCancellation(
            slowToStop('service'),
            {},
            environment(controller),
            controller,
        );
        await vi.advanceTimersByTimeAsync(0);

        controller.abort();
        await vi.advanceTimersByTimeAsync(20_000);

        expect((await running).envelope).toMatchObject({ status: 'ok', output: { stopped: true } });
    });

    it('gives up on any other command after the grace period', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const running = executeWithCancellation(
            slowToStop('mutating'),
            {},
            environment(controller),
            controller,
        );
        await vi.advanceTimersByTimeAsync(0);

        controller.abort();
        await vi.advanceTimersByTimeAsync(10_000);

        expect((await running).envelope.error?.code).toBe('cli.cancelled');
    });

    it('gives up on a service command that has not stopped after 30 seconds', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const running = executeWithCancellation(
            slowToStop('service', 60_000),
            {},
            environment(controller),
            controller,
        );
        await vi.advanceTimersByTimeAsync(0);

        controller.abort();
        await vi.advanceTimersByTimeAsync(30_000);

        expect((await running).envelope.error?.code).toBe('cli.cancelled');
    });
});
