import {
    CommandDefinition,
    CommandPlan,
    defineCommand,
    defineError,
    fail,
    failed,
    incomplete,
} from '@vendure/common/lib/command';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { runCommandInHarness } from './__tests__/command-harness.js';
import { consentDigest } from './digest.js';
import { formatFix } from './host.js';

const input = z.object({
    name: z.string().describe('The name'),
    count: z.number().optional(),
});

const brokenError = defineError<{ what: string }>({
    code: 'test.broken',
    exit: 4,
    message: ({ what }) => `${what} is broken`,
    fix: () => [{ path: ['auth', 'login'], input: { token: 'x' }, description: 'Sign in' }],
});

function makeCommand(
    run: (input: any, ctx: any) => Promise<unknown>,
    extra: Partial<CommandDefinition> = {},
): CommandDefinition {
    return defineCommand({
        path: ['test', 'run'],
        description: 'A test command',
        behavior: 'mutating',
        schemas: async () => ({ input }),
        errors: [brokenError],
        run: async () => ({ run: run as any }),
        ...extra,
    });
}

describe('executeCommand', () => {
    it('returns ok with the output', async () => {
        const result = await runCommandInHarness(
            makeCommand(async i => ({ hello: i.name })),
            { name: 'a' },
        );
        expect(result.exitCode).toBe(0);
        expect(result.envelope).toEqual({
            schemaVersion: 1,
            status: 'ok',
            output: { hello: 'a' },
            notices: [],
        });
    });

    it('returns incomplete with an input need and its choices when a required input is missing', async () => {
        const run = vi.fn();
        const def = makeCommand(run, {
            cli: { fields: { name: { choices: async () => ['one', 'two'] } } },
        });
        const result = await runCommandInHarness(def, {});
        expect(result.exitCode).toBe(3);
        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.needs).toEqual([
            { kind: 'input', field: 'name', description: 'The name', choices: ['one', 'two'] },
        ]);
        expect(run).not.toHaveBeenCalled();
    });

    it('marks a secret input need', async () => {
        const def = makeCommand(async () => ({}), { cli: { fields: { name: { secret: true } } } });
        const result = await runCommandInHarness(def, {});
        expect(result.envelope.needs?.[0]).toMatchObject({ kind: 'input', field: 'name', secret: true });
    });

    it('returns an error for an input that is present and wrong', async () => {
        const result = await runCommandInHarness(
            makeCommand(async () => ({})),
            { name: 'a', count: 'x' },
        );
        expect(result.envelope.status).toBe('error');
        expect(result.envelope.error?.code).toBe('input.invalid');
        expect(result.exitCode).toBe(1);
    });

    it('returns failed with the output and a non-zero exit code', async () => {
        const result = await runCommandInHarness(
            makeCommand(async () => failed({ checks: 2 })),
            {
                name: 'a',
            },
        );
        expect(result.envelope.status).toBe('failed');
        expect(result.envelope.output).toEqual({ checks: 2 });
        expect(result.exitCode).toBe(1);
    });

    it('turns a declared error into a coded envelope with structured fixes', async () => {
        const result = await runCommandInHarness(
            makeCommand(async () => fail(brokenError, { what: 'the thing' })),
            { name: 'a' },
        );
        expect(result.envelope.error).toEqual({
            code: 'test.broken',
            exit: 4,
            message: 'the thing is broken',
            fixes: [{ path: ['auth', 'login'], input: { token: 'x' }, description: 'Sign in' }],
        });
        expect(result.exitCode).toBe(4);
    });

    it('reports an undeclared error code as internal', async () => {
        const other = defineError({ code: 'other', exit: 1, message: () => '' });
        const result = await runCommandInHarness(
            makeCommand(async () => fail(other, {})),
            { name: 'a' },
        );
        expect(result.envelope.error?.code).toBe('internal');
    });

    it('turns a thrown error into an internal error', async () => {
        const result = await runCommandInHarness(
            makeCommand(async () => {
                throw new Error('boom');
            }),
            { name: 'a' },
        );
        expect(result.envelope.error).toMatchObject({ code: 'internal', message: 'boom' });
    });

    it('lets run return incomplete with the output of the stages that finished', async () => {
        const result = await runCommandInHarness(
            makeCommand(async () =>
                incomplete(
                    [
                        {
                            kind: 'person',
                            action: 'approve',
                            summary: 'Approve it',
                            url: 'https://example.com',
                        },
                    ],
                    { done: ['build'] },
                ),
            ),
            { name: 'a' },
        );
        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.output).toEqual({ done: ['build'] });
        expect(result.envelope.needs?.[0].kind).toBe('person');
        expect(result.exitCode).toBe(3);
    });

    it('collects notices into the envelope and reports events', async () => {
        const result = await runCommandInHarness(
            makeCommand(async (_i, ctx) => {
                ctx.notice('warning', 'backup id 7');
                ctx.progress('halfway', 1, 2);
                ctx.event('custom', { a: 1 });
                return {};
            }),
            { name: 'a' },
        );
        expect(result.envelope.notices).toEqual([{ level: 'warning', message: 'backup id 7' }]);
        expect(result.events).toEqual([
            { vendure: 'event', type: 'notice', level: 'warning', message: 'backup id 7' },
            { vendure: 'event', type: 'progress', message: 'halfway', current: 1, total: 2 },
            { vendure: 'event', type: 'custom', a: 1 },
        ]);
    });

    it('refuses a command that needs a project when there is none', async () => {
        const result = await runCommandInHarness(
            makeCommand(async () => ({}), { requires: { project: true } }),
            { name: 'a' },
            { projectRoot: undefined },
        );
        expect(result.envelope.error?.code).toBe('project.required');
    });

    it('starts processes only through ctx.spawn', async () => {
        const result = await runCommandInHarness(
            makeCommand(async (_i, ctx) => ({ code: (await ctx.spawn('npm', ['i'])).exitCode })),
            { name: 'a' },
            { spawn: async () => ({ exitCode: 7, stdout: '', stderr: '' }) },
        );
        expect(result.spawned).toEqual([{ command: 'npm', args: ['i'] }]);
        expect(result.envelope.output).toEqual({ code: 7 });
    });

    it('fails the harness when run writes to stdout', async () => {
        await expect(
            runCommandInHarness(
                makeCommand(async () => {
                    process.stdout.write('hello');
                    return {};
                }),
                { name: 'a' },
            ),
        ).rejects.toThrow(/wrote to the console/);
    });

    it('marks MCP calls on the context', async () => {
        const result = await runCommandInHarness(
            makeCommand(async (_i, ctx) => ({ mcp: ctx.mcp })),
            { name: 'a' },
            { mcp: true },
        );
        expect(result.envelope.output).toEqual({ mcp: true });
    });

    it('does not run when the signal fired before run()', async () => {
        const controller = new AbortController();
        controller.abort();
        const run = vi.fn(async () => ({}));
        const result = await runCommandInHarness(
            makeCommand(run),
            { name: 'a' },
            { signal: controller.signal },
        );
        expect(result.envelope.error?.code).toBe('cancelled');
        expect(run).not.toHaveBeenCalled();
    });

    it('stops with a cancelled error when run() throws after the signal fired', async () => {
        const controller = new AbortController();
        const result = await runCommandInHarness(
            makeCommand(async () => {
                controller.abort();
                throw new Error('aborted');
            }),
            { name: 'a' },
            { signal: controller.signal },
        );
        expect(result.envelope.error?.code).toBe('cancelled');
    });

    // A revert or a file write that finished must not be reported as cancelled.
    it('reports what run() returned, even when the signal fired while it ran', async () => {
        const controller = new AbortController();
        const result = await runCommandInHarness(
            makeCommand(async () => {
                controller.abort();
                return { reverted: true };
            }),
            { name: 'a' },
            { signal: controller.signal },
        );
        expect(result.envelope).toMatchObject({ status: 'ok', output: { reverted: true } });
    });
});

describe('executeCommand with plan()', () => {
    const preview = { target: 'db-1', migration: 'M1' };
    const plan = vi.fn(async (): Promise<CommandPlan> => ({ preview, requiredConsents: ['destroyData'] }));

    function planned(run: (...args: any[]) => Promise<unknown> = async () => ({ done: true })) {
        return makeCommand(run, {
            behavior: 'destructive',
            consents: { destroyData: 'Destroys the data in db-1' },
            plan: async () => ({ plan }),
        });
    }

    it('returns incomplete with a consent need that carries the digest and the preview', async () => {
        const run = vi.fn(async () => ({}));
        const result = await runCommandInHarness(planned(run), { name: 'a' });
        expect(result.envelope.status).toBe('incomplete');
        expect(result.envelope.needs).toEqual([
            {
                kind: 'consent',
                consent: 'destroyData',
                description: 'Destroys the data in db-1',
                digest: consentDigest('destroyData', preview),
                preview,
            },
        ]);
        expect(run).not.toHaveBeenCalled();
    });

    it('runs when the digest of the same preview is passed back', async () => {
        const result = await runCommandInHarness(planned(), {
            name: 'a',
            destroyData: consentDigest('destroyData', preview),
        });
        expect(result.envelope.status).toBe('ok');
    });

    it('asks again when the target changed since the consent', async () => {
        const stale = consentDigest('destroyData', { target: 'db-0', migration: 'M1' });
        const run = vi.fn(async () => ({}));
        const result = await runCommandInHarness(planned(run), { name: 'a', destroyData: stale });
        expect(result.envelope.status).toBe('incomplete');
        expect(run).not.toHaveBeenCalled();
    });

    it('does not take the consent for another consent name or a yes', async () => {
        const result = await runCommandInHarness(planned(), { name: 'a', destroyData: 'yes' });
        expect(result.envelope.status).toBe('incomplete');
    });

    it('checks the inputs before it plans', async () => {
        plan.mockClear();
        const result = await runCommandInHarness(planned(), {});
        expect(result.envelope.needs?.[0].kind).toBe('input');
        expect(plan).not.toHaveBeenCalled();
    });

    it('returns a coded error from plan() without running', async () => {
        const run = vi.fn(async () => ({}));
        const command = makeCommand(run, {
            behavior: 'destructive',
            consents: { destroyData: 'Destroys the data' },
            plan: async () => ({ plan: async () => fail(brokenError, { what: 'The database' }) }),
        });
        const result = await runCommandInHarness(command, { name: 'a' });
        expect(result.envelope.error).toMatchObject({
            code: 'test.broken',
            message: 'The database is broken',
        });
        expect(result.exitCode).toBe(4);
        expect(run).not.toHaveBeenCalled();
    });

    it('rejects a plan that asks for a consent the command did not declare', async () => {
        const result = await runCommandInHarness(
            makeCommand(async () => ({}), {
                plan: async () => ({ plan: async () => ({ preview: {}, requiredConsents: ['nope'] }) }),
            }),
            { name: 'a' },
        );
        expect(result.envelope.error?.code).toBe('internal');
    });

    it('asks a person for consent and runs after a yes, with no digest needed', async () => {
        const askConsent = vi.fn(async () => true);
        const result = await runCommandInHarness(
            planned(),
            { name: 'a' },
            { prompter: { askInput: async () => undefined, askConsent } },
        );
        expect(askConsent).toHaveBeenCalledOnce();
        expect(result.envelope.status).toBe('ok');
    });

    it('stops when a person says no', async () => {
        const result = await runCommandInHarness(
            planned(),
            { name: 'a' },
            { prompter: { askInput: async () => undefined, askConsent: async () => false } },
        );
        expect(result.envelope.error?.code).toBe('cancelled');
    });
});

describe('executeCommand prompting', () => {
    it('asks a person for a missing input and runs with the answer', async () => {
        const askInput = vi.fn(async () => 'typed');
        const result = await runCommandInHarness(
            makeCommand(async i => ({ got: i.name })),
            {},
            { prompter: { askInput, askConsent: async () => true } },
        );
        expect(askInput).toHaveBeenCalledWith(
            { kind: 'input', field: 'name', description: 'The name' },
            expect.any(Function),
            false,
        );
        expect(result.envelope.output).toEqual({ got: 'typed' });
    });

    it('asks a person for an optional field marked prompt, and keeps its default on an empty answer', async () => {
        const askInput = vi.fn(async (need: { field: string }) => (need.field === 'count' ? '' : 'x'));
        const command = makeCommand(async i => ({ got: i }), {
            cli: { fields: { count: { prompt: true } } },
        });
        const result = await runCommandInHarness(
            command,
            { name: 'a' },
            {
                prompter: { askInput, askConsent: async () => true },
            },
        );
        expect(askInput).toHaveBeenCalledTimes(1);
        expect(askInput).toHaveBeenCalledWith(
            expect.objectContaining({ field: 'count' }),
            expect.any(Function),
            true,
        );
        expect(result.envelope.output).toEqual({ got: { name: 'a' } });
    });

    // A person corrects a bad answer at the prompt, instead of the run ending with input.invalid.
    it('gives the prompt a check that uses the input schema', async () => {
        const checked = defineCommand({
            path: ['demo'],
            description: 'Demo',
            behavior: 'readonly',
            schemas: () =>
                Promise.resolve({
                    input: z.object({
                        name: z.string().regex(/^[a-z]+$/, 'Use lowercase letters'),
                        count: z.number().int('Use a whole number').optional(),
                    }),
                }),
            cli: { fields: { count: { prompt: true } } },
            run: () => Promise.resolve({ run: (i: unknown) => Promise.resolve(i) }),
        });
        const checks: Record<string, (answer: string) => string | undefined> = {};
        const askInput = vi.fn(
            (need: { field: string }, validate: (answer: string) => string | undefined) => {
                checks[need.field] = validate;
                return Promise.resolve(need.field === 'name' ? 'abc' : '');
            },
        );

        await runCommandInHarness(
            checked,
            {},
            { prompter: { askInput, askConsent: () => Promise.resolve(true) } },
        );

        expect(checks.name('Not Valid')).toBe('Use lowercase letters');
        expect(checks.name('valid')).toBeUndefined();
        expect(checks.count('1.5')).toBe('Use a whole number');
        // An empty answer keeps the default of an optional field.
        expect(checks.count('')).toBeUndefined();
    });

    it('uses the answer for an optional field marked prompt', async () => {
        const command = makeCommand(async i => ({ got: i }), {
            cli: { fields: { count: { prompt: true } } },
        });
        const result = await runCommandInHarness(
            command,
            { name: 'a' },
            {
                prompter: { askInput: async () => '3', askConsent: async () => true },
            },
        );
        expect(result.envelope.output).toEqual({ got: { name: 'a', count: 3 } });
    });

    it('does not ask for an optional field marked prompt when no person is present', async () => {
        const command = makeCommand(async i => ({ got: i }), {
            cli: { fields: { count: { prompt: true } } },
        });
        const result = await runCommandInHarness(command, { name: 'a' });
        expect(result.envelope).toMatchObject({ status: 'ok', output: { got: { name: 'a' } } });
    });

    it('stops when the person cancels the prompt', async () => {
        const result = await runCommandInHarness(
            makeCommand(async () => ({})),
            {},
            { prompter: { askInput: async () => undefined, askConsent: async () => true } },
        );
        expect(result.envelope.error?.code).toBe('cancelled');
    });
});

describe('formatFix', () => {
    it('shows a fix as a command line', () => {
        expect(formatFix({ path: ['console', 'link'], input: { projectDir: 'a b', force: true } })).toBe(
            'vendure console link --project-dir "a b" --force',
        );
    });

    // Leaving a boolean out lets the command choose its default, so false needs its own flag.
    it('writes a false boolean as --no-<flag>', () => {
        expect(formatFix({ path: ['deploy'], input: { wait: false, check: ['config'] } })).toBe(
            'vendure deploy --no-wait --check ["config"]',
        );
    });
});
