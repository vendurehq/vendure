import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Counted messages must be ICU plurals, not English suffixes spliced into a `<Trans>`.
 *
 * `<Trans>Found {n} method{n !== 1 ? 's' : ''}</Trans>` extracts as
 * `Found {0} method{1}` with the English `'s'` passed in as a placeholder, so every
 * locale gets the English suffix appended (German rendered "2 geeignete
 * Versandmethodes gefunden") and words such as `'country' : 'countries'` stayed English
 * in every language. `<Plural>` / `plural()` hand the whole sentence to translators,
 * who then fill in the plural categories their language actually has.
 */

const localesDir = join(dirname(fileURLToPath(import.meta.url)), 'locales');

const locales = readdirSync(localesDir)
    .filter(file => file.endsWith('.po'))
    .map(file => file.slice(0, -3))
    .sort();

function readCatalog(locale: string): string {
    return readFileSync(join(localesDir, `${locale}.po`), 'utf-8');
}

/** msgid -> msgstr for the active (non-obsolete) entries of one catalog. */
function catalogEntries(locale: string): Map<string, string> {
    const pattern = /^msgid "((?:[^"\\]|\\.)*)"\nmsgstr "((?:[^"\\]|\\.)*)"$/gm;
    return new Map([...readCatalog(locale).matchAll(pattern)].map(match => [match[1], match[2]]));
}

/** Split `{count, plural, one {...} other {...}}` into its variable and arms. */
function parsePlural(message: string): { variable: string; arms: Map<string, string> } | undefined {
    const head = /^\{(\w+), plural, /.exec(message);
    if (!head || !message.endsWith('}')) {
        return undefined;
    }
    const arms = new Map<string, string>();
    const body = message.slice(head[0].length, -1);
    let i = 0;
    while (i < body.length) {
        const key = /^\s*(=\d+|\w+)\s*\{/.exec(body.slice(i));
        if (!key) {
            return undefined;
        }
        const start = i + key[0].length;
        let depth = 1;
        let end = start;
        for (; end < body.length && depth > 0; end++) {
            if (body[end] === '{') depth++;
            if (body[end] === '}') depth--;
        }
        if (depth !== 0) {
            return undefined;
        }
        arms.set(key[1], body.slice(start, end - 1));
        i = end;
        while (body[i] === ' ') i++;
    }
    return { variable: head[1], arms };
}

function placeholders(text: string): Set<string> {
    return new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]));
}

describe('plural messages', () => {
    const sourcePlurals = [...catalogEntries('en').keys()].filter(
        id => id.startsWith('{') && parsePlural(id),
    );

    it('finds the plural messages in the source catalog', () => {
        expect(sourcePlurals).toContain(
            '{0, plural, one {Found # eligible shipping method} other {Found # eligible shipping methods}}',
        );
        expect(locales.length).toBeGreaterThan(20);
    });

    it('does not pass count-dependent English words into translated messages', () => {
        const handRolled = [...readCatalog('en').matchAll(/^#\. placeholder \{\d+\}: (.*)$/gm)]
            .map(match => match[1])
            .filter(expression => /(?:[!=]==?|[<>]=?)\s*1\s*\?/.test(expression));
        expect(handRolled, 'use <Plural> or plural() instead of a ternary on the count').toEqual([]);
    });

    it.each(locales)('keeps the %s plural translations well-formed', locale => {
        const entries = catalogEntries(locale);
        const problems: string[] = [];
        for (const msgid of sourcePlurals) {
            const msgstr = entries.get(msgid);
            if (!msgstr) {
                // Untranslated entries fall back to English and are reported by i18n:check.
                continue;
            }
            const source = parsePlural(msgid);
            const translated = parsePlural(msgstr);
            if (!source || !translated) {
                problems.push(`unparseable: ${msgid}`);
                continue;
            }
            // Numeric placeholders are positional copies of the count, which `#` replaces.
            const named = (arms: Map<string, string>) =>
                new Set(
                    [...arms.values()].flatMap(arm => [...placeholders(arm)].filter(n => !/^\d+$/.test(n))),
                );
            const expected = named(source.arms);
            const actual = named(translated.arms);
            if (translated.variable !== source.variable) problems.push(`wrong variable: ${msgid}`);
            if (!translated.arms.has('other')) problems.push(`no "other" arm: ${msgid}`);
            if ([...expected].some(name => !actual.has(name))) problems.push(`placeholder dropped: ${msgid}`);
        }
        expect(problems).toEqual([]);
    });
});
