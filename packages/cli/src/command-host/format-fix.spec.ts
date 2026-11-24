import { describe, expect, it } from 'vitest';

import { describeFix, readFixes } from './format-fix.js';

describe('describeFix', () => {
    it('adds the command line when the fix is a command', () => {
        expect(
            describeFix({ description: 'Generate a migration', path: ['migrate', 'generate'], input: {} }),
        ).toBe('Generate a migration: vendure migrate generate');
    });

    it('is the description when the fix is not a command', () => {
        expect(describeFix({ description: 'Rename the field' })).toBe('Rename the field');
    });
});

describe('readFixes', () => {
    it('returns no fixes for a value that is not a list', () => {
        expect(readFixes(undefined)).toEqual([]);
        expect(readFixes({ description: 'x' })).toEqual([]);
    });

    it('keeps the description of every entry that has one, and a well-formed command', () => {
        expect(
            readFixes([
                { description: 'Rename the field', extra: 1 },
                { description: 'Generate a migration', path: ['migrate', 'generate'], input: { name: 'x' } },
                { description: 'Half a command', path: ['migrate'] },
                { path: ['migrate'], input: {} },
                null,
            ]),
        ).toEqual([
            { description: 'Rename the field' },
            { description: 'Generate a migration', path: ['migrate', 'generate'], input: { name: 'x' } },
            { description: 'Half a command' },
        ]);
    });
});
