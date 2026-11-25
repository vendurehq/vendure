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

    it('refuses a run that overlaps another', async () => {
        let release: () => void = () => undefined;
        const slow = defineCommand({
            path: ['acme', 'slow'],
            description: 'Slow',
            behavior: 'readonly',
            schemas: async () => ({ input: z.object({}) }),
            run: async () => ({ run: () => new Promise<object>(resolve => (release = () => resolve({}))) }),
        });
        const first = testCommand(slow, {});
        await expect(testCommand(greet, { name: 'Ada' })).rejects.toThrow('must not overlap');
        // Let the first run reach run() before releasing it.
        await new Promise(resolve => setTimeout(resolve, 50));
        release();
        await expect(first).resolves.toMatchObject({ envelope: { status: 'ok' } });
    });
});
