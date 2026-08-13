import { UserInputError } from '../../../common/error/errors';
import { Logger } from '../../../config/logger/vendure-logger';
import { VendureDatabaseType } from '../../../connection/database-type';

const loggerCtx = 'ListQueryBuilder';

/**
 * A compiled regular expression able to test string values. Both the built-in `RegExp`
 * and the RE2 engine satisfy this shape.
 */
interface CompiledRegExp {
    test(value: string): boolean;
}

type RegExpEngine = new (pattern: string, flags: string) => CompiledRegExp;

/**
 * The SQLite driver flavours whose `regexp` implementation is a JS function evaluated on the
 * Node.js event loop, and which are therefore exposed to ReDoS via the built-in `RegExp` engine.
 */
const SQLITE_REGEXP_DB_TYPES: VendureDatabaseType[] = ['better-sqlite3', 'sqljs'];

// `undefined` = not yet attempted, `null` = re2 is not installed.
let re2Engine: RegExpEngine | null | undefined;

/**
 * Lazily resolves the optional `re2` dependency. RE2 matches in guaranteed linear time and so
 * cannot be driven into catastrophic backtracking, unlike the built-in backtracking `RegExp`.
 */
function loadRe2Engine(): RegExpEngine | null {
    if (re2Engine === undefined) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            re2Engine = require('re2') as RegExpEngine;
        } catch {
            re2Engine = null;
        }
    }
    return re2Engine;
}

/**
 * Throws a {@link UserInputError} if a `regex` filter cannot be evaluated safely on the given
 * database. On SQLite backends the pattern runs through the {@link https://github.com/google/re2 | RE2}
 * engine, which does not support backtracking-only features such as lookaround and backreferences;
 * these are rejected up-front with a clear error rather than failing mid-query.
 *
 * Has no effect when `re2` is not installed (the built-in engine, which supports those features,
 * is used as a fallback) or on non-SQLite backends, where the pattern is evaluated by the database.
 */
export function assertRegexFilterEngineCompatible(pattern: string, dbType: VendureDatabaseType): void {
    if (!SQLITE_REGEXP_DB_TYPES.includes(dbType)) {
        return;
    }
    const Engine = loadRe2Engine();
    if (!Engine) {
        return;
    }
    try {
        // eslint-disable-next-line no-new
        new Engine(pattern, 'i');
    } catch {
        throw new UserInputError('error.regex-filter-pattern-unsupported-syntax');
    }
}

/**
 * Builds the memoised tester used by the SQLite `regexp` user-defined function. Patterns are
 * compiled once per distinct value and cached, since a given query applies a single constant
 * pattern across every row.
 */
export function buildRegexpTester(Engine: RegExpEngine): (pattern: string, value: string) => number {
    const cache = new Map<string, CompiledRegExp>();
    return (pattern: string, value: string): number => {
        let compiled = cache.get(pattern);
        if (!compiled) {
            compiled = new Engine(pattern, 'i');
            // Bound the cache: patterns are user-supplied, so cap unbounded growth.
            if (cache.size >= 100) {
                cache.clear();
            }
            cache.set(pattern, compiled);
        }
        return compiled.test(value) ? 1 : 0;
    };
}

/**
 * Creates the JS function registered as SQLite's `REGEXP` implementation. When the optional
 * `re2` dependency is installed, patterns are evaluated by RE2 in guaranteed linear time and so
 * cannot be exploited for ReDoS. Otherwise it falls back to the built-in `RegExp` engine — which
 * is vulnerable to catastrophic backtracking on adversarial patterns — and warns once at startup.
 */
export function createSqliteRegexpFunction(): (pattern: string, value: string) => number {
    const Engine = loadRe2Engine();
    if (!Engine) {
        Logger.warn(
            'The optional "re2" package is not installed, so `regex` list filters fall back to the ' +
                'built-in RegExp engine. On SQLite-based databases this evaluates untrusted patterns on ' +
                'the Node.js event loop and is vulnerable to ReDoS. Install "re2" to evaluate regex ' +
                'filters in guaranteed linear time.',
            loggerCtx,
        );
    }
    return buildRegexpTester(Engine ?? (RegExp as unknown as RegExpEngine));
}
