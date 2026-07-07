import { describe, expect, it } from 'vitest';

import { isNonInteractiveEnvironment, isTruthyEnvVar } from './utils';

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
});
