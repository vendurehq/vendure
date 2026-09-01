import { describe, expect, it } from 'vitest';

import { UserInputError } from '../../../common/error/errors';

import {
    assertRegexFilterEngineCompatible,
    buildRegexpTester,
    createSqliteRegexpFunction,
    Re2jsRegExp,
} from './sqlite-regexp-function';

// A pattern that is catastrophically slow under the backtracking RegExp engine but harmless
// under RE2. See GHSA-jgm3-qmp2-c4p7. The trailing `Z` after `$` makes every match attempt
// fail, forcing exhaustive backtracking over all 1-/2-char partitions of the input.
const REDOS_PATTERN = '^(.|..)+$Z';
const REDOS_INPUT = 'x'.repeat(60);

/**
 * Milliseconds taken by one call. RE2 needs a fraction of one at this input length. The backtracking
 * engine needs minutes, so a regression here fails by vitest timeout rather than by the assertion.
 */
function timeMs(run: () => void): number {
    const start = process.hrtime.bigint();
    run();
    return Number(process.hrtime.bigint() - start) / 1e6;
}

describe('Re2jsRegExp', () => {
    // The one line of adapter logic, asserted directly: `re2js` is a caret range, so a minor
    // release can move `compile`, `matcher` or `find` and this is where that should fail.
    it('matches case-insensitively anywhere in the value', () => {
        expect(new Re2jsRegExp('foo', 'i').test('a FOO b')).toBe(true);
        expect(new Re2jsRegExp('^bar$', 'i').test('BAR')).toBe(true);
        expect(new Re2jsRegExp('^bar$', 'i').test('bard')).toBe(false);
    });

    it('rejects a pattern RE2 cannot compile', () => {
        expect(() => new Re2jsRegExp('(?=.*foo)bar', 'i')).toThrow();
    });
});

describe('buildRegexpTester()', () => {
    it('matches case-insensitively and returns 1/0', () => {
        const test = buildRegexpTester(RegExp);
        expect(test('foo', 'a FOO b')).toBe(1);
        expect(test('^bar$', 'bar')).toBe(1);
        expect(test('^bar$', 'bard')).toBe(0);
    });

    // SQLite hands the raw column value to the user-defined function, so a nullable column yields
    // null and a numeric one yields a number. RE2 accepts strings only and throws on anything else,
    // where the built-in RegExp coerced silently, so both engines are asserted here.
    it.each([
        ['the RE2 engine', Re2jsRegExp],
        ['the built-in engine', RegExp as unknown as typeof Re2jsRegExp],
    ])('treats a null value as no match under %s', (_name, Engine) => {
        const test = buildRegexpTester(Engine);
        expect(test('a', null as unknown as string)).toBe(0);
        expect(test('a', undefined as unknown as string)).toBe(0);
    });

    it.each([
        ['the RE2 engine', Re2jsRegExp],
        ['the built-in engine', RegExp as unknown as typeof Re2jsRegExp],
    ])('matches a numeric value by its string form under %s', (_name, Engine) => {
        const test = buildRegexpTester(Engine);
        expect(test('^12', 123 as unknown as string)).toBe(1);
        expect(test('^9', 123 as unknown as string)).toBe(0);
    });

    it('reuses a compiled pattern across calls', () => {
        let compilations = 0;
        class CountingRegExp {
            private re: RegExp;
            constructor(pattern: string, flags: string) {
                compilations++;
                this.re = new RegExp(pattern, flags);
            }
            test(value: string) {
                return this.re.test(value);
            }
        }
        const test = buildRegexpTester(CountingRegExp as any);
        test('foo', 'foo');
        test('foo', 'barfoo');
        test('foo', 'nope');
        expect(compilations).toBe(1);
    });
});

describe('createSqliteRegexpFunction()', () => {
    it('returns a working case-insensitive tester', () => {
        const regexpFn = createSqliteRegexpFunction();
        expect(regexpFn('widget', 'Blue Widget')).toBe(1);
        expect(regexpFn('^exact$', 'exact')).toBe(1);
        expect(regexpFn('^exact$', 'not exact')).toBe(0);
    });

    // The reason this file exists: the function registered with SQLite must be the RE2 one, not the
    // built-in engine, or a single crafted pattern blocks the event loop (GHSA-jgm3-qmp2-c4p7).
    it('evaluates a ReDoS pattern in linear time', () => {
        const regexpFn = createSqliteRegexpFunction();
        let result: number | undefined;
        const elapsedMs = timeMs(() => (result = regexpFn(REDOS_PATTERN, REDOS_INPUT)));
        expect(result).toBe(0);
        expect(elapsedMs).toBeLessThan(1000);
    });
});

describe('assertRegexFilterEngineCompatible()', () => {
    it('does nothing for non-SQLite backends', () => {
        // Lookaround is unsupported by RE2 but fine for the Postgres engine, so it must not throw here.
        expect(() => assertRegexFilterEngineCompatible('(?=.*foo)bar', 'postgres')).not.toThrow();
        expect(() => assertRegexFilterEngineCompatible('(a)\\1', 'mysql')).not.toThrow();
    });

    it('allows normal patterns on SQLite backends', () => {
        expect(() => assertRegexFilterEngineCompatible('^[a-z0-9-]+$', 'better-sqlite3')).not.toThrow();
        expect(() => assertRegexFilterEngineCompatible('foo.*bar', 'sqljs')).not.toThrow();
    });

    it('rejects RE2-incompatible syntax on SQLite backends', () => {
        expect(() => assertRegexFilterEngineCompatible('(?=.*foo)bar', 'better-sqlite3')).toThrowError(
            UserInputError,
        );
        expect(() => assertRegexFilterEngineCompatible('(a)\\1', 'sqljs')).toThrowError(UserInputError);
    });
});
