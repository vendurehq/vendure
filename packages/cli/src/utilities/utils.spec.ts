import { log } from '@clack/prompts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CliCommandExit } from '../shared/cli-command-exit';

import { isNonInteractiveEnvironment, isTruthyEnvVar, withInteractiveTimeout } from './utils';

vi.mock('@clack/prompts', () => ({
    log: { warning: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const TERMINAL = { stdin: { isTTY: true }, stdout: { isTTY: true }, env: {} };
const NO_TERMINAL = { stdin: { isTTY: false }, stdout: { isTTY: false }, env: {} };

describe('CLI utilities', () => {
    describe('isTruthyEnvVar()', () => {
        it('treats common falsey env values as false', () => {
            expect(isTruthyEnvVar(undefined)).toBe(false);
            expect(isTruthyEnvVar('')).toBe(false);
            expect(isTruthyEnvVar('0')).toBe(false);
            expect(isTruthyEnvVar('false')).toBe(false);
            expect(isTruthyEnvVar('FALSE')).toBe(false);
        });

        it('treats other env values as true', () => {
            expect(isTruthyEnvVar('1')).toBe(true);
            expect(isTruthyEnvVar('true')).toBe(true);
            expect(isTruthyEnvVar('yes')).toBe(true);
        });
    });

    describe('isNonInteractiveEnvironment()', () => {
        it('returns false when stdin and stdout are TTYs and env does not force non-interactive mode', () => {
            expect(
                isNonInteractiveEnvironment({
                    stdin: { isTTY: true },
                    stdout: { isTTY: true },
                    env: {},
                }),
            ).toBe(false);
        });

        it('returns true when stdin is not a TTY', () => {
            expect(
                isNonInteractiveEnvironment({
                    stdin: { isTTY: false },
                    stdout: { isTTY: true },
                    env: {},
                }),
            ).toBe(true);
        });

        it('returns true when stdout is not a TTY', () => {
            expect(
                isNonInteractiveEnvironment({
                    stdin: { isTTY: true },
                    stdout: { isTTY: false },
                    env: {},
                }),
            ).toBe(true);
        });

        it('returns true when CI is truthy', () => {
            expect(
                isNonInteractiveEnvironment({
                    stdin: { isTTY: true },
                    stdout: { isTTY: true },
                    env: { CI: 'true' },
                }),
            ).toBe(true);
        });

        it('returns true when VENDURE_CLI_NON_INTERACTIVE is truthy', () => {
            expect(
                isNonInteractiveEnvironment({
                    stdin: { isTTY: true },
                    stdout: { isTTY: true },
                    env: { VENDURE_CLI_NON_INTERACTIVE: 'true' },
                }),
            ).toBe(true);
        });
    });

    // CLO-1166 — a person at a terminal is not told they are an automated tool
    describe('withInteractiveTimeout()', () => {
        afterEach(() => {
            vi.useRealTimers();
            vi.clearAllMocks();
        });

        it('waits for a person at a terminal however long they take', async () => {
            vi.useFakeTimers();
            let answer: (value: string) => void = () => undefined;
            const result = withInteractiveTimeout(() => new Promise<string>(resolve => (answer = resolve)), {
                environment: TERMINAL,
            });

            await vi.advanceTimersByTimeAsync(10 * 60_000);
            answer('chosen');

            await expect(result).resolves.toBe('chosen');
            expect(log.warning).not.toHaveBeenCalled();
        });

        it('stops a prompt nobody can answer and names the flags that answer it', async () => {
            vi.useFakeTimers();
            const result = withInteractiveTimeout(() => new Promise<string>(() => undefined), {
                environment: NO_TERMINAL,
                examples: ['vendure console link --console-project <id|slug>'],
                helpCommands: ['vendure console --help'],
            });
            const rejection = expect(result).rejects.toBeInstanceOf(CliCommandExit);

            await vi.advanceTimersByTimeAsync(60_000);

            await rejection;
            const output = [...vi.mocked(log.warning).mock.calls, ...vi.mocked(log.info).mock.calls].join(
                '\n',
            );
            expect(output).toContain('No answer after 60 seconds');
            expect(output).toContain('This run is non-interactive');
            expect(output).toContain('   vendure console link --console-project <id|slug>');
            expect(output).toContain('   vendure console --help');
            expect(output).not.toMatch(/AI agent|automated environment/);
        });

        it('returns the answer of a prompt that a non-interactive run answers in time', async () => {
            await expect(
                withInteractiveTimeout(() => Promise.resolve(true), { environment: NO_TERMINAL }),
            ).resolves.toBe(true);
        });
    });
});
