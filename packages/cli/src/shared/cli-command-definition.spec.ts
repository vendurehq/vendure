import { describe, expect, it } from 'vitest';

import { CliCommandContext, readCommandContext, readCommandOptions } from './cli-command-definition';

/**
 * The argument list a command action receives: positionals, then Commander's
 * parsed options, then the Command, then the context the host appends.
 */
function actionArgs(positionals: unknown[], options: Record<string, any>): unknown[] {
    const context: CliCommandContext = { inheritedOptions: { token: 'tok' }, commandPath: ['a', 'b'] };
    return [...positionals, options, { name: () => 'b' }, context];
}

describe('readCommandContext()', () => {
    it('reads the context from an action argument list', () => {
        const context = readCommandContext(actionArgs(['x'], { limit: '5' }));

        expect(context.commandPath).toEqual(['a', 'b']);
        expect(context.inheritedOptions.token).toBe('tok');
    });

    it('reads the context whatever the number of positionals', () => {
        expect(readCommandContext(actionArgs([], {})).commandPath).toEqual(['a', 'b']);
        expect(readCommandContext(actionArgs(['x', 'y', 'z'], {})).commandPath).toEqual(['a', 'b']);
    });

    it('throws when handed something that is not an action argument list', () => {
        expect(() => readCommandContext([])).toThrow(/No CliCommandContext found/);
        expect(() => readCommandContext(['just', 'strings'])).toThrow(/No CliCommandContext found/);
    });
});

describe('readCommandOptions()', () => {
    it('reads the parsed options from an action argument list', () => {
        expect(readCommandOptions(actionArgs(['x'], { limit: '5' }))).toEqual({ limit: '5' });
    });

    it('reads the options whatever the number of positionals', () => {
        expect(readCommandOptions(actionArgs([], { a: 1 }))).toEqual({ a: 1 });
        expect(readCommandOptions(actionArgs(['x', 'y'], { a: 1 }))).toEqual({ a: 1 });
    });

    it('throws rather than returning an empty object, like its sibling', () => {
        expect(() => readCommandOptions([])).toThrow(/No parsed options found/);
        expect(() => readCommandOptions(['a', 'b', 'c'])).toThrow(/No parsed options found/);
    });
});
