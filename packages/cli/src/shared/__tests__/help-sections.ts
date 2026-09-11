/**
 * The body of one help section: everything from `heading` up to the blank line
 * that ends it.
 *
 * Lets a test say which section something is listed in, which neither
 * `toContain` over the whole screen nor comparing string offsets can do —
 * `indexOf` returns -1 for text that is absent, and -1 is less than every
 * offset, so an ordering assertion passes when the text is missing entirely.
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
