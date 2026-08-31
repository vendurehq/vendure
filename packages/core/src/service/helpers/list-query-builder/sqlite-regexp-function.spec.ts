import { describe, expect, it } from 'vitest';

import { UserInputError } from '../../../common/error/errors';

import {
    assertRegexFilterEngineCompatible,
    buildRegexpTester,
    createSqliteRegexpFunction,
    loadRe2Engine,
} from './sqlite-regexp-function';

// `re2js` is a devDependency of this package, so the engine resolves here and the RE2-specific
// assertions below always run. The assertions which pass `RegExp` directly to `buildRegexpTester()`
// cover the behaviour a consumer gets when they have not installed it.
const RE2 = loadRe2Engine();

// A pattern that is catastrophically slow under the backtracking RegExp engine but harmless
// under RE2. See GHSA-jgm3-qmp2-c4p7. The trailing `Z` after `$` makes every match attempt
// fail, forcing exhaustive backtracking over all 1-/2-char partitions of the input.
const REDOS_PATTERN = '^(.|..)+$Z';

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
        ['the RE2 engine', () => RE2 as NonNullable<typeof RE2>],
        ['the built-in engine', () => RegExp as unknown as NonNullable<typeof RE2>],
    ])('treats a null value as no match under %s', (_name, engine) => {
        const test = buildRegexpTester(engine());
        expect(test('a', null as unknown as string)).toBe(0);
        expect(test('a', undefined as unknown as string)).toBe(0);
    });

    it.each([
        ['the RE2 engine', () => RE2 as NonNullable<typeof RE2>],
        ['the built-in engine', () => RegExp as unknown as NonNullable<typeof RE2>],
    ])('matches a numeric value by its string form under %s', (_name, engine) => {
        const test = buildRegexpTester(engine());
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

    it('evaluates a ReDoS pattern in linear time under RE2', () => {
        expect(RE2).not.toBeNull();
        const test = buildRegexpTester(RE2 as NonNullable<typeof RE2>);
        const input = 'x'.repeat(60);
        const start = process.hrtime.bigint();
        const result = test(REDOS_PATTERN, input);
        const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
        expect(result).toBe(0);
        // RE2 completes in well under a millisecond; the backtracking engine takes many seconds.
        expect(elapsedMs).toBeLessThan(1000);
    });
});

describe('createSqliteRegexpFunction()', () => {
    it('returns a working case-insensitive tester', () => {
        const regexpFn = createSqliteRegexpFunction();
        expect(regexpFn('widget', 'Blue Widget')).toBe(1);
        expect(regexpFn('^exact$', 'exact')).toBe(1);
        expect(regexpFn('^exact$', 'not exact')).toBe(0);
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
