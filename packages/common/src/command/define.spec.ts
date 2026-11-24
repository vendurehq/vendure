import { describe, expect, it } from 'vitest';

import {
    defineCommand,
    defineError,
    fail,
    failed,
    incomplete,
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
        for (const code of [
            'devserver.not-running',
            'core.config.invalid-custom-fields',
            'cli.dev.port-in-use',
            'api.v2',
        ]) {
            expect(isValidErrorCode(code)).toBe(true);
        }
    });

    it('refuses a code without a namespace, with upper case, underscores or empty parts', () => {
        for (const code of [
            'not-running',
            'Devserver.not-running',
            'auth.token_expired',
            'core..x',
            'core.',
            '1core.x',
        ]) {
            expect(isValidErrorCode(code)).toBe(false);
        }
    });
});
