import { defineCommand, defineError, fail } from '@vendure/common/lib/command';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { testCommand } from '../index.js';

const greet = defineCommand({
    path: ['acme', 'greet'],
    description: 'Greet',
    behavior: 'readonly',
    schemas: async () => ({
        input: z.object({ name: z.string() }),
        output: z.object({ message: z.string() }),
    }),
    run: async () => ({
        run: async (input: { name: string }, ctx) => {
            ctx.progress('greeting');
            await ctx.spawn('git', ['status', '--porcelain'], { quiet: true });
            return { message: `Hello, ${input.name}!` };
        },
    }),
});

describe('testCommand', () => {
    it('runs a command through the host and reports its envelope, events and processes', async () => {
        const result = await testCommand(greet, { name: 'Ada' });

        expect(result.envelope).toMatchObject({ status: 'ok', output: { message: 'Hello, Ada!' } });
        expect(result.exitCode).toBe(0);
        expect(result.input).toEqual({ name: 'Ada' });
        expect(result.events).toContainEqual(
            expect.objectContaining({ type: 'progress', message: 'greeting' }),
        );
        expect(result.spawned).toEqual([
            { command: 'git', args: ['status', '--porcelain'], options: { quiet: true } },
        ]);
    });

    it('reports ctx.output as an output event, on stdout unless the command says otherwise', async () => {
        const follow = defineCommand({
            path: ['acme', 'follow'],
            description: 'Follow',
            behavior: 'readonly',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async (_input: object, ctx) => {
                    ctx.output('line 1\n');
                    ctx.output('oops\n', 'stderr');
                    return {};
                },
            }),
        });

        const result = await testCommand(follow, {});

        expect(result.envelope.status).toBe('ok');
        expect(result.events.filter(event => event.type === 'output')).toEqual([
            { vendure: 'event', type: 'output', stream: 'stdout', text: 'line 1\n' },
            { vendure: 'event', type: 'output', stream: 'stderr', text: 'oops\n' },
        ]);
    });

    it('reports a missing input as an input need, as without a person', async () => {
        const result = await testCommand(greet, {});
        expect(result.envelope).toMatchObject({
            status: 'incomplete',
            needs: [{ kind: 'input', field: 'name' }],
        });
        expect(result.exitCode).toBe(3);
    });

    it('hands a requires.auth command the credential, or stops it with the token need', async () => {
        const whoami = defineCommand({
            path: ['acme', 'whoami'],
            description: 'Who am I',
            behavior: 'readonly',
            requires: { auth: 'cloud' },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({ run: async (_input: object, ctx) => ({ source: ctx.credential?.source }) }),
        });

        const signedIn = await testCommand(whoami, {}, { credential: { source: 'environment', token: 't' } });
        expect(signedIn.envelope.output).toEqual({ source: 'environment' });

        const signedOut = await testCommand(whoami, {});
        expect(signedOut.envelope).toMatchObject({
            status: 'incomplete',
            needs: [{ kind: 'input', field: 'token' }],
        });
    });

    it("reports a command's coded error", async () => {
        const broken = defineError<{ reason: string }>({
            code: 'acme.broken',
            exit: 2,
            message: ({ reason }) => `Broken: ${reason}`,
        });
        const failing = defineCommand({
            path: ['acme', 'fail'],
            description: 'Fail',
            behavior: 'readonly',
            errors: [broken],
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({ run: async () => fail(broken, { reason: 'no' }) }),
        });
        const result = await testCommand(failing, {});
        expect(result.envelope.error).toMatchObject({ code: 'acme.broken', message: 'Broken: no' });
        expect(result.exitCode).toBe(2);
    });

    it('fails when the command writes to the console itself', async () => {
        const noisy = defineCommand({
            path: ['acme', 'noisy'],
            description: 'Noisy',
            behavior: 'readonly',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async () => {
                    process.stdout.write('hello\n');
                    return {};
                },
            }),
        });
        await expect(testCommand(noisy, {})).rejects.toThrow('The command wrote to the console: hello');
    });

    it('fails when the command prints with console.log, which a test runner replaces', async () => {
        const logging = defineCommand({
            path: ['acme', 'log'],
            description: 'Log',
            behavior: 'readonly',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: async () => {
                    // eslint-disable-next-line no-console
                    console.log('chatty');
                    return {};
                },
            }),
        });
        await expect(testCommand(logging, {})).rejects.toThrow('The command wrote to the console: chatty');
    });

    it('records a stream write by its chunk, and calls the write callback', async () => {
        const writing = defineCommand({
            path: ['acme', 'write'],
            description: 'Write',
            behavior: 'readonly',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: () =>
                    new Promise<object>(resolve => {
                        process.stdout.write('x\n', 'utf8', () => resolve({}));
                    }),
            }),
        });
        await expect(testCommand(writing, {})).rejects.toThrow(/wrote to the console: x\n$/);
    });

    it('runs overlapping commands, and puts the console back when the last one ends', async () => {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const originalWrite = process.stdout.write;
        let release: () => void = () => undefined;
        let started: () => void = () => undefined;
        const reached = new Promise<void>(resolve => (started = resolve));
        const slow = defineCommand({
            path: ['acme', 'slow'],
            description: 'Slow',
            behavior: 'readonly',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({
                run: () =>
                    new Promise<object>(resolve => {
                        release = () => resolve({});
                        started();
                    }),
            }),
        });
        const first = testCommand(slow, {});
        await reached;
        await expect(testCommand(greet, { name: 'Ada' })).resolves.toMatchObject({
            envelope: { status: 'ok' },
        });
        // The first run is still in progress, so the console is still replaced.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(process.stdout.write).not.toBe(originalWrite);
        release();
        await expect(first).resolves.toMatchObject({ envelope: { status: 'ok' } });
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(process.stdout.write).toBe(originalWrite);
    });

    it('reports the cwd it is given, and runs a project command outside a project', async () => {
        const whereAmI = defineCommand({
            path: ['acme', 'where'],
            description: 'Where',
            behavior: 'readonly',
            requires: { project: true },
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({ run: async (_input: object, ctx) => ({ cwd: ctx.cwd }) }),
        });
        const inside = await testCommand(whereAmI, {}, { cwd: '/tmp/acme' });
        expect(inside.envelope.output).toEqual({ cwd: '/tmp/acme' });

        const outside = await testCommand(whereAmI, {}, { projectRoot: undefined });
        expect(outside.envelope.error?.code).toBe('project.required');
    });

    it('puts the console back when the run is aborted, even if the command never settles', async () => {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const originalWrite = process.stdout.write;
        const hanging = defineCommand({
            path: ['acme', 'hang'],
            description: 'Hang',
            behavior: 'readonly',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({ run: () => new Promise<object>(() => undefined) }),
        });
        const controller = new AbortController();
        void testCommand(hanging, {}, { signal: controller.signal }).catch(() => undefined);
        await new Promise(resolve => setImmediate(resolve));
        controller.abort();
        // eslint-disable-next-line @typescript-eslint/unbound-method
        expect(process.stdout.write).toBe(originalWrite);
    });
});
