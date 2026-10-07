import Module from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UserInputError } from '../../../common/error/errors';

import {
    assertRegexFilterEngineCompatible,
    buildRegexpTester,
    createSqliteRegexpFunction,
    MAX_REGEX_PROGRAM_SIZE,
    Re2jsRegExp,
} from './sqlite-regexp-function';

// The source loads re2js with `require()`, which resolves its CommonJS build. A static `import`
// here would resolve the ESM build, whose exception classes are different objects.
const { RE2JSSyntaxException } = Module.createRequire(__filename)('re2js') as typeof import('re2js');

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
    // The one line of adapter logic, asserted directly: `re2js` is a tilde range, so a patch
    // release can still move `compile`, `matcher` or `find` and this is where that should fail.
    it('matches case-insensitively anywhere in the value', () => {
        expect(new Re2jsRegExp('foo', 'i').test('a FOO b')).toBe(true);
        expect(new Re2jsRegExp('^bar$', 'i').test('BAR')).toBe(true);
        expect(new Re2jsRegExp('^bar$', 'i').test('bard')).toBe(false);
    });

    it('rejects a pattern RE2 cannot compile', () => {
        expect(() => new Re2jsRegExp('(?=.*foo)bar', 'i')).toThrowError(RE2JSSyntaxException);
    });

    // JavaScript-only escapes are translated to RE2 syntax rather than rejected. `\uXXXX` and `\cX`
    // match what the built-in engine matched.
    it.each([
        ['\\u0041', 'A'],
        ['\\cA', '\u0001'],
    ])('translates the JavaScript escape %s', (pattern, value) => {
        expect(new Re2jsRegExp(`^${pattern}$`, 'i').test(value)).toBe(true);
        expect(new RegExp(`^${pattern}$`, 'i').test(value)).toBe(true);
    });

    // A behaviour change: without the `u` flag the built-in engine read `\u{41}` as `u` repeated
    // 41 times. RE2 reads it as the code point, as the native `re2` package did.
    it('gives \\u{...} its code point meaning', () => {
        expect(new Re2jsRegExp('^\\u{41}$', 'i').test('A')).toBe(true);
        expect(new Re2jsRegExp('^\\u{41}$', 'i').test('u'.repeat(41))).toBe(false);
        expect(new RegExp('^\\u{41}$', 'i').test('u'.repeat(41))).toBe(true);
    });

    // Each of these is valid in both engines but matches something different in RE2.
    it.each(['\\Afoo', 'foo\\z', '\\Q.\\E', '\\a', '\\x{41}', '[^]]', '[]a]', '[[:alpha:]]'])(
        'rejects %s, which RE2 reads differently from JavaScript',
        pattern => {
            expect(() => new Re2jsRegExp(pattern, 'i')).toThrowError(RE2JSSyntaxException);
        },
    );

    it('accepts the two-digit \\x escape, which both engines read the same way', () => {
        expect(new Re2jsRegExp('^\\x41$', 'i').test('A')).toBe(true);
    });

    it('accepts an escaped ] and a literal [ inside a class', () => {
        expect(new Re2jsRegExp('^[\\]a]$', 'i').test(']')).toBe(true);
        expect(new Re2jsRegExp('^[a[]$', 'i').test('[')).toBe(true);
    });

    // A literal or alternation filling the 100-character length cap stays under the program cap.
    it('accepts a literal and an alternation at the length cap', () => {
        expect(() => new Re2jsRegExp('x'.repeat(100), 'i')).not.toThrow();
        const alternation =
            'red|green|blue|yellow|black|white|orange|purple|silver|golden|maroon|violet|indigo|crimson|teal';
        expect(() => new Re2jsRegExp(alternation, 'i')).not.toThrow();
    });

    // Patterns that compile to a large RE2 program are rejected.
    it('rejects a pattern whose compiled program is too large', () => {
        expect(() => new Re2jsRegExp('.{999}', 'i')).toThrowError(UserInputError);
        expect(() => new Re2jsRegExp('.{999}.{999}.{999}.{999}', 'i')).toThrowError(UserInputError);
    });

    // Close to the worst accepted pattern found by search: a long `.` repeat at the size cap.
    it('evaluates the largest accepted program against a 100k-character value quickly', () => {
        // `.{n}y` compiles to n + 3 instructions, so this is exactly at the cap.
        const pattern = `.{${MAX_REGEX_PROGRAM_SIZE - 3}}y`;
        const regexp = new Re2jsRegExp(pattern, 'i');
        let result: boolean | undefined;
        const elapsedMs = timeMs(() => (result = regexp.test('x'.repeat(100_000))));
        expect(result).toBe(false);
        expect(elapsedMs).toBeLessThan(2000);
    });

    // translateRegExp() would rewrite `\k<n>` to the literal text `k<n>`, so it is rejected first.
    it('rejects a named backreference instead of matching it literally', () => {
        expect(() => new Re2jsRegExp('(?<n>a)\\k<n>', 'i')).toThrowError(RE2JSSyntaxException);
    });

    it('does not mistake an escaped backslash before k< for a named backreference', () => {
        expect(new Re2jsRegExp('\\\\k<n>', 'i').test('\\k<n>')).toBe(true);
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
        expect(test('a', null)).toBe(0);
        expect(test('a', undefined)).toBe(0);
    });

    it.each([
        ['the RE2 engine', Re2jsRegExp],
        ['the built-in engine', RegExp as unknown as typeof Re2jsRegExp],
    ])('matches a numeric value by its string form under %s', (_name, Engine) => {
        const test = buildRegexpTester(Engine);
        expect(test('^12', 123)).toBe(1);
        expect(test('^9', 123)).toBe(0);
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
        const test = buildRegexpTester(CountingRegExp);
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

    // These are valid JavaScript regex syntax but not RE2 syntax, and are listed in the docs.
    it.each(['(?<n>a)\\k<n>', '[^]', 'a{1001}'])(
        'rejects the JavaScript-only syntax %s on SQLite backends',
        pattern => {
            expect(() => assertRegexFilterEngineCompatible(pattern, 'sqljs')).toThrowError(UserInputError);
        },
    );

    it('accepts named groups, which RE2 supports', () => {
        expect(() => assertRegexFilterEngineCompatible('(?<word>foo)bar', 'sqljs')).not.toThrow();
    });

    it.each(['\\u0041', '\\u{1F600}', '\\cA'])('accepts the translated JavaScript escape %s', pattern => {
        expect(() => assertRegexFilterEngineCompatible(pattern, 'sqljs')).not.toThrow();
    });
});

// A missing or broken engine must surface as its own error. Reporting it as unsupported syntax
// would hide the fault, and falling back to the built-in RegExp would reopen the ReDoS.
describe('when re2js cannot be loaded', () => {
    const moduleWithLoad = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
    const originalLoad = moduleWithLoad._load;

    afterEach(() => {
        moduleWithLoad._load = originalLoad;
        vi.resetModules();
    });

    async function importWithFailingRe2js() {
        moduleWithLoad._load = function (request: string, ...rest: unknown[]) {
            if (request === 're2js') {
                throw new Error("Cannot find module 're2js'");
            }
            return originalLoad.call(this, request, ...rest);
        };
        // A fresh module instance, so the engine cached by earlier tests is not reused.
        vi.resetModules();
        return import('./sqlite-regexp-function');
    }

    it('rethrows the load error from the filter pre-check', async () => {
        const fresh = await importWithFailingRe2js();
        let thrown: unknown;
        try {
            fresh.assertRegexFilterEngineCompatible('foo', 'sqljs');
        } catch (e) {
            thrown = e;
        }
        expect(thrown).toBeInstanceOf(Error);
        expect(thrown).not.toBeInstanceOf(UserInputError);
        expect((thrown as Error).message).toContain("Cannot find module 're2js'");
    });

    it('fails when the SQLite regexp function is created', async () => {
        const fresh = await importWithFailingRe2js();
        expect(() => fresh.createSqliteRegexpFunction()).toThrowError("Cannot find module 're2js'");
    });
});
