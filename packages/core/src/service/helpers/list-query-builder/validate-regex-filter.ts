import { UserInputError } from '../../../common/error/errors';

/**
 * Maximum permitted length of a `regex` filter pattern. Patterns longer than this
 * are rejected outright as a cheap first line of defence before any structural analysis.
 */
export const MAX_REGEX_FILTER_LENGTH = 100;

/**
 * Validates a user-supplied `StringOperators.regex` filter value, throwing a
 * {@link UserInputError} if the pattern is too long or has a structure prone to
 * catastrophic backtracking (ReDoS).
 *
 * The `regex` filter is exposed on the public Shop API and, on SQLite backends, is
 * evaluated by a synchronous JS user-defined function on the Node.js event loop. An
 * unvalidated pattern such as `(a+)+$` can therefore block the entire server. This
 * check is a conservative static analysis applied at the single parse-layer choke
 * point, so it protects all database backends regardless of how they evaluate the regex.
 *
 * It is a heuristic, not a proof: it reliably rejects exponential nested-quantifier
 * patterns (star height >= 2) but does not attempt to catch every pathological regex
 * (e.g. alternation-overlap such as `(a|a)+`). Combined with the length cap, it closes
 * the documented attack class while leaving legitimate filters untouched.
 */
export function assertSafeRegexFilter(pattern: string): void {
    if (pattern.length > MAX_REGEX_FILTER_LENGTH) {
        throw new UserInputError('error.regex-filter-pattern-too-long', { max: MAX_REGEX_FILTER_LENGTH });
    }
    if (getRegexStarHeight(pattern) >= 2) {
        throw new UserInputError('error.regex-filter-pattern-unsafe');
    }
}

/**
 * Computes the "star height" of a regex pattern: the deepest nesting of *amplifying*
 * quantifiers (those that can match 2+ times — `*`, `+`, `{n,}`, `{n,m}` with max >= 2).
 * A value >= 2 means an amplifying quantifier is applied to a sub-expression that itself
 * contains one (e.g. `(a+)+`), which is the structure responsible for exponential
 * backtracking. Bounded quantifiers (`?`, `{0,1}`, `{1}`) do not amplify.
 *
 * Escaped characters and character classes are treated as single atoms so their contents
 * are never mistaken for grouping or quantifier syntax.
 */
function getRegexStarHeight(pattern: string): number {
    // Each frame records whether the group at that nesting level already contains an
    // amplifying quantifier. Index 0 is the implicit top-level group.
    const stack: Array<{ hasAmplifier: boolean }> = [{ hasAmplifier: false }];
    let maxHeight = 0;
    let i = 0;
    const n = pattern.length;

    while (i < n) {
        const char = pattern[i];

        if (char === '(') {
            stack.push({ hasAmplifier: false });
            i = skipGroupPrefix(pattern, i + 1);
            continue;
        }

        if (char === ')') {
            const frame = stack.length > 1 ? stack.pop()! : stack[0];
            const quantifier = readQuantifier(pattern, i + 1);
            i = quantifier.present ? quantifier.next : i + 1;
            const parent = stack[stack.length - 1];
            if (quantifier.amplifying) {
                // The group is repeated by an amplifying quantifier, so it is itself an
                // amplifier in the parent's body. If the group also contains one, that is
                // amplifier-over-amplifier: star height >= 2.
                parent.hasAmplifier = true;
                maxHeight = Math.max(maxHeight, frame.hasAmplifier ? 2 : 1);
            } else if (frame.hasAmplifier) {
                // Grouping is transparent to star height: an amplifier inside an
                // unquantified group still counts as an amplifier in the parent's body.
                parent.hasAmplifier = true;
            }
            continue;
        }

        // Otherwise the current position starts an atom (escaped char, character class,
        // or single literal/metacharacter) which may be followed by a quantifier.
        if (char === '\\') {
            i += 2;
        } else if (char === '[') {
            i = skipCharacterClass(pattern, i);
        } else {
            i += 1;
        }
        const quantifier = readQuantifier(pattern, i);
        if (quantifier.present) {
            i = quantifier.next;
            if (quantifier.amplifying) {
                stack[stack.length - 1].hasAmplifier = true;
                maxHeight = Math.max(maxHeight, 1);
            }
        }
    }
    return maxHeight;
}

/**
 * Skips a group-opening prefix immediately after a `(`, handling non-capturing groups
 * `(?:`, lookaheads `(?=` / `(?!`, lookbehinds `(?<=` / `(?<!` and named groups `(?<name>`.
 * Returns the index of the first character of the group's body.
 */
function skipGroupPrefix(pattern: string, i: number): number {
    if (pattern[i] !== '?') {
        return i;
    }
    i++; // skip '?'
    const char = pattern[i];
    if (char === ':' || char === '=' || char === '!') {
        return i + 1;
    }
    if (char === '<') {
        i++;
        if (pattern[i] === '=' || pattern[i] === '!') {
            return i + 1; // lookbehind
        }
        // named group: skip to the closing '>'
        while (i < pattern.length && pattern[i] !== '>') {
            i++;
        }
        return i < pattern.length ? i + 1 : i;
    }
    return i;
}

/**
 * Skips a character class `[...]` starting at `i` (which must point at `[`), accounting
 * for an initial `^`/`]` and escaped characters. Returns the index after the closing `]`.
 */
function skipCharacterClass(pattern: string, i: number): number {
    let j = i + 1;
    if (pattern[j] === '^') {
        j++;
    }
    if (pattern[j] === ']') {
        j++; // a `]` as the first member is a literal
    }
    while (j < pattern.length && pattern[j] !== ']') {
        if (pattern[j] === '\\') {
            j++;
        }
        j++;
    }
    return j < pattern.length ? j + 1 : j;
}

/**
 * Reads a quantifier at position `i`, if present. `amplifying` is true when the quantifier
 * can match two or more times (`*`, `+`, `{n,}`, `{n,m}` with max >= 2) and false for
 * bounded-to-one quantifiers (`?`, `{0,1}`, `{1}`). A trailing lazy `?` is consumed.
 */
function readQuantifier(
    pattern: string,
    i: number,
): { present: boolean; amplifying: boolean; next: number } {
    const char = pattern[i];
    if (char === '*' || char === '+') {
        const next = pattern[i + 1] === '?' ? i + 2 : i + 1;
        return { present: true, amplifying: true, next };
    }
    if (char === '?') {
        const next = pattern[i + 1] === '?' ? i + 2 : i + 1;
        return { present: true, amplifying: false, next };
    }
    if (char === '{') {
        const match = /^\{(\d*)(,(\d*))?\}/.exec(pattern.slice(i));
        if (match) {
            const min = match[1] === '' ? 0 : parseInt(match[1], 10);
            const hasComma = match[2] !== undefined;
            const max = !hasComma ? min : match[3] === '' ? Infinity : parseInt(match[3], 10);
            let next = i + match[0].length;
            if (pattern[next] === '?') {
                next++;
            }
            return { present: true, amplifying: max >= 2, next };
        }
    }
    return { present: false, amplifying: false, next: i };
}
