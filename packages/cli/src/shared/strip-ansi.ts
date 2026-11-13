/** The ESC that opens every ANSI escape sequence. */
const ESC = String.fromCharCode(27);

/**
 * Removes ANSI escape codes.
 *
 * Whether the CLI colours what it writes depends on the environment it runs in,
 * not on the command: picocolors emits codes when it detects colour support,
 * and lerna's streaming output turns that on in CI while a plain local run
 * leaves it off. A test asserting on what the CLI said should not depend on how
 * the suite was started, so both test harnesses strip what they capture. A test
 * about colour itself calls the styling function directly.
 */
export function stripAnsi(text: string): string {
    return text.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

/**
 * The escape sequences the project marker and legend are styled with, for tests
 * that assert on colour. Named here rather than written into each expectation,
 * which would either repeat an opaque literal or, worse, rebuild it from the
 * same helper the implementation calls and pass whatever that produced.
 */
export const ANSI = {
    yellow: `${ESC}[33m`,
    dim: `${ESC}[2m`,
    colorReset: `${ESC}[39m`,
    dimReset: `${ESC}[22m`,
};
