import { defineCommand, defineError, fail } from '@vendure/common/lib/command';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { presentForPeople } from './present.js';
import { runCoreCommand } from './run-core-command.js';

const failure = defineError<Record<string, never>>({
    code: 'demo.failed',
    exit: 1,
    message: () => 'It failed',
});

const seen = vi.hoisted(() => ({ inputs: [] as Array<Record<string, unknown>> }));

vi.mock('./core-commands.js', () => ({
    coreCommandDefinitions: [
        defineCommand({
            path: ['demo', 'echo'],
            description: 'Echoes its input',
            behavior: 'readonly',
            schemas: () =>
                Promise.resolve({
                    input: z.object({ name: z.string().optional(), fail: z.boolean().optional() }),
                }),
            errors: [failure],
            run: () =>
                Promise.resolve({
                    run: (input: Record<string, unknown>) => {
                        seen.inputs.push(input);
                        return Promise.resolve(input.fail ? fail(failure, {}) : { echoed: input });
                    },
                }),
        }),
    ],
}));

vi.mock('./present.js', () => ({ presentForPeople: vi.fn(() => Promise.resolve()) }));

// No person is asked: the run must not wait for a prompt.
vi.mock('../utilities/utils.js', () => ({ isNonInteractiveEnvironment: () => true }));

describe('runCoreCommand()', () => {
    beforeEach(() => {
        seen.inputs = [];
        vi.mocked(presentForPeople).mockClear();
    });

    it('runs the command with the given path and presents its result', async () => {
        await expect(runCoreCommand(['demo', 'echo'], { name: 'x' })).resolves.toMatchObject({
            exitCode: 0,
            envelope: { status: 'ok' },
        });

        expect(seen.inputs).toEqual([{ name: 'x' }]);
        expect(vi.mocked(presentForPeople).mock.calls[0][1].envelope).toMatchObject({
            status: 'ok',
            output: { echoed: { name: 'x' } },
        });
    });

    // An old flag that was not given arrives as undefined, and must leave the field to the host.
    it('leaves out the input fields that are undefined', async () => {
        await runCoreCommand(['demo', 'echo'], { name: undefined });

        expect(seen.inputs).toEqual([{}]);
    });

    it("returns the exit code of the command's error", async () => {
        await expect(runCoreCommand(['demo', 'echo'], { fail: true })).resolves.toMatchObject({
            exitCode: 1,
        });
    });

    it('throws for a path the CLI does not declare', async () => {
        await expect(runCoreCommand(['demo', 'missing'])).rejects.toThrow(
            'The CLI has no command "demo missing"',
        );
    });
});
