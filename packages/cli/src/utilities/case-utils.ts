/**
 * Small set of string-case conversion helpers used by the CLI scaffolding
 * commands. Vendored to avoid the `change-case` v4 dependency, which pulled
 * fifteen separate micro-packages (one per case style) into every CLI install.
 *
 * The algorithm mirrors the upstream `no-case` / `pascal-case` packages so
 * results are interchangeable for the inputs the CLI cares about (user-typed
 * plugin/service/entity names from `@clack/prompts`). The full upstream test
 * cases are covered in case-utils.spec.ts.
 */

/**
 * Splits a string into words at:
 *   - any non-alphanumeric character ("foo-bar" → ["foo", "bar"])
 *   - the boundary between a lowercase/digit and an uppercase letter
 *     ("camelCase" → ["camel", "Case"])
 *   - the boundary between consecutive uppercase letters and an
 *     uppercase-lowercase pair ("CAMELCase" → ["CAMEL", "Case"])
 *
 * Tokens retain their original casing; the case-style functions below
 * apply their own lower/upper transforms when joining. Empty input
 * yields an empty array.
 */
function words(input: string): string[] {
    return input
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

/**
 * Capitalises a token. For any token after the first whose first
 * character is a digit, the result is prefixed with `_` so that
 * `pascalCase("version 1.2.10")` yields `"Version_1_2_10"` rather than
 * the ambiguous `"Version1210"`.
 */
function pascalToken(word: string, index: number): string {
    const first = word.charAt(0);
    const rest = word.slice(1).toLowerCase();
    if (index > 0 && first >= '0' && first <= '9') {
        return '_' + first + rest;
    }
    return first.toUpperCase() + rest;
}

export function camelCase(input: string): string {
    const tokens = words(input);
    return tokens.map((w, i) => (i === 0 ? w.toLowerCase() : pascalToken(w, i))).join('');
}

export function pascalCase(input: string): string {
    return words(input)
        .map((w, i) => pascalToken(w, i))
        .join('');
}

export function kebabCase(input: string): string {
    return words(input)
        .map(w => w.toLowerCase())
        .join('-');
}

export function constantCase(input: string): string {
    return words(input)
        .map(w => w.toUpperCase())
        .join('_');
}
