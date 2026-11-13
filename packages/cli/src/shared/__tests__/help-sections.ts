/**
 * The body of one help section: everything from `heading` up to the blank line
 * that ends it.
 *
 * Lets a test say which section something is listed in. `toContain` over the
 * whole screen cannot say that. Comparing string offsets passes when the text
 * is absent, because `indexOf` returns -1 and -1 sorts below every real
 * offset.
 *
 * Returns an empty string when the heading is absent, so an assertion about
 * the section's contents fails rather than passing by accident.
 */
export function sectionAfter(help: string, heading: string): string {
    const start = help.indexOf(`\n${heading}`);
    if (start === -1) {
        return '';
    }
    const body = help.slice(start + heading.length + 1);
    const end = body.indexOf('\n\n');
    return end === -1 ? body : body.slice(0, end);
}
