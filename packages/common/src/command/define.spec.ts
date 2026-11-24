import { describe, expect, it } from 'vitest';

import {
    defineCommand,
    defineError,
    fail,
    failed,
    incomplete,
    isCommandFix,
    isErrorResult,
    isFailedResult,
    isIncompleteResult,
    isValidErrorCode,
} from './define';

describe('command contract helpers', () => {
    it('defineCommand returns the object it is given', () => {
        const definition = {
            path: ['x'],
            description: 'x',
            behavior: 'readonly' as const,
            schemas: async () => ({}) as any,
            run: async () => ({ run: async () => ({}) }),
        };
        expect(defineCommand(definition)).toBe(definition);
    });

    it('defineError returns the object it is given', () => {
        const error = { code: 'a.b', exit: 2, message: () => 'm' };
        expect(defineError(error)).toBe(error);
    });

    it('incomplete returns a plain object that can be serialized', () => {
        const result = incomplete([{ kind: 'input', field: 'name', description: 'The name' }]);
        expect(JSON.parse(JSON.stringify(result))).toEqual({
            vendureResult: 'incomplete',
            needs: [{ kind: 'input', field: 'name', description: 'The name' }],
        });
        expect(isIncompleteResult(result)).toBe(true);
    });

    it('incomplete carries the partial output of finished stages', () => {
        expect(incomplete([], { stage: 1 }).output).toEqual({ stage: 1 });
    });

    it('tells the result kinds apart', () => {
        const error = defineError({ code: 'e', exit: 1, message: () => '' });
        expect(isFailedResult(failed({ a: 1 }))).toBe(true);
        expect(isErrorResult(fail(error, {}))).toBe(true);
        expect(isIncompleteResult(failed({}))).toBe(false);
        expect(isFailedResult({ status: 'failed' })).toBe(false);
        expect(isFailedResult(null)).toBe(false);
    });
});

describe('isValidErrorCode', () => {
    it('accepts a namespace followed by dot-separated kebab-case parts', () => {
        const codes = [
            'devserver.not-running',
            'core.config.invalid-custom-fields',
            'cli.dev.port-in-use',
            'api.v2',
            'cli.ts-2322',
        ];
        expect(codes.filter(code => !isValidErrorCode(code))).toEqual([]);
    });

    it('refuses a code without a namespace, with upper case, underscores, empty parts or stray hyphens', () => {
        const codes = [
            'not-running',
            'Devserver.not-running',
            'auth.token_expired',
            'core..x',
            'core.',
            '1core.x',
            'core.-x',
            'core.x-',
            'core.a--b',
            'core.x.-',
        ];
        expect(codes.filter(code => isValidErrorCode(code))).toEqual([]);
    });
});

describe('isCommandFix', () => {
    it('is true for a fix that names a command', () => {
        expect(isCommandFix({ description: 'Generate one', path: ['migrate', 'generate'], input: {} })).toBe(
            true,
        );
    });

    it('is false for a fix that only says what to change', () => {
        expect(isCommandFix({ description: 'Rename the field' })).toBe(false);
    });

    it('is false when the path or the input is missing or malformed', () => {
        expect(isCommandFix({ description: 'x', path: ['migrate'] })).toBe(false);
        expect(isCommandFix({ description: 'x', input: {} })).toBe(false);
        expect(isCommandFix({ description: 'x', path: [], input: {} })).toBe(false);
        expect(isCommandFix({ description: 'x', path: ['a'], input: [] as any })).toBe(false);
        expect(isCommandFix({ description: 'x', path: [1] as any, input: {} })).toBe(false);
    });
});
