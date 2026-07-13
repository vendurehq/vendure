import { describe, expect, it } from 'vitest';

import { UserInputError } from '../../../common/error/errors';

import { assertSafeRegexFilter, MAX_REGEX_FILTER_LENGTH } from './validate-regex-filter';

describe('assertSafeRegexFilter()', () => {
    describe('allows safe patterns', () => {
        const safe = [
            '',
            'foo',
            'foo.*bar',
            '^foo$',
            'a+',
            'a*',
            'a?',
            '\\d+',
            '[a-z]+',
            '[a-z]*[0-9]+',
            'foo|bar',
            '(foo|bar)',
            '(foo|bar)+', // group with no inner amplifier, amplified once -> star height 1
            '(abc)+',
            'a+b+c+', // multiple sibling amplifiers, still star height 1
            '(a+)', // inner amplifier, group not amplified -> star height 1
            '(a+)?', // bounded outer quantifier does not amplify
            '(a+){0,1}',
            '(a+){1}',
            'colou?r',
            '\\([a-z]+\\)', // escaped parens are literals, not a group
            '[(]a+[)]+', // the brackets are char classes, not grouping
            '(?:abc)+',
            '(?=foo)bar',
            '(?<name>abc)+',
            'a{2,5}',
        ];
        for (const pattern of safe) {
            it(`accepts ${JSON.stringify(pattern)}`, () => {
                expect(() => assertSafeRegexFilter(pattern)).not.toThrow();
            });
        }
    });

    describe('rejects catastrophic-backtracking patterns (star height >= 2)', () => {
        const dangerous = [
            '(a+)+',
            '(a+)+$',
            '^(a+)+$',
            '(a*)*',
            '(a+)*',
            '(a*)+',
            '([a-z]+)*',
            '(\\d+)+',
            '(.*)+',
            '((a+))+', // amplifier nested two groups deep
            '((a+)?)+', // optional inner does not break the amplification chain
            '(?:a+)+', // non-capturing group still counts
            '(a+){2}', // bounded-but->=2 outer quantifier amplifies
            '(a+){2,}',
            '(ba+){3,}',
        ];
        for (const pattern of dangerous) {
            it(`rejects ${JSON.stringify(pattern)}`, () => {
                expect(() => assertSafeRegexFilter(pattern)).toThrowError(UserInputError);
            });
        }
    });

    describe('length limit', () => {
        it('accepts a pattern at the maximum length', () => {
            const pattern = 'a'.repeat(MAX_REGEX_FILTER_LENGTH);
            expect(() => assertSafeRegexFilter(pattern)).not.toThrow();
        });

        it('rejects a pattern exceeding the maximum length', () => {
            const pattern = 'a'.repeat(MAX_REGEX_FILTER_LENGTH + 1);
            expect(() => assertSafeRegexFilter(pattern)).toThrowError(UserInputError);
        });
    });

    it('treats a quantifier inside a character class as a literal', () => {
        // `[+*]` is a class matching the literal chars `+` and `*`, so `[+*]+` is star height 1.
        expect(() => assertSafeRegexFilter('([+*])')).not.toThrow();
    });
});
