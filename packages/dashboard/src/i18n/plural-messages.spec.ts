import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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

const i18nDir = dirname(fileURLToPath(import.meta.url));
const localesDir = join(i18nDir, 'locales');
const srcDir = join(i18nDir, '..');

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

function tsxFiles(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
            return tsxFiles(path);
        }
        return path.endsWith('.tsx') ? [path] : [];
    });
}

/**
 * `file:line: code` for each line which picks a string with a ternary on a count of 1,
 * such as `n > 1 ? 's' : ''` or a choice between two `t` templates.
 */
function countTernaryLines(file: string): string[] {
    return readFileSync(file, 'utf-8')
        .split('\n')
        .flatMap((line, index) =>
            /(?:[!=]==?|[<>]=?)\s*1\s*\?\s*t?['"`]/.test(line) && !line.includes('className')
                ? [`${relative(srcDir, file)}:${index + 1}: ${line.trim()}`]
                : [],
        );
}

/**
 * `file: name` for each variable which holds a translated fragment and is spliced into a
 * plural message, such as `const destination = t\`top level\`` used in
 * `` other={`Moving # collections into ${destination}`} ``.
 */
function splicedFragments(file: string): string[] {
    const source = readFileSync(file, 'utf-8');
    const fragments = new Set(
        [...source.matchAll(/\bconst (\w+) =([^;]*);/g)]
            .filter(match => /\bt`/.test(match[2]))
            .map(match => match[1]),
    );
    const arms = [...source.matchAll(/\b(?:zero|one|two|few|many|other|_\d+)[=:]\s*\{?`([^`]*)`/g)];
    const spliced = arms
        .flatMap(match => [...match[1].matchAll(/\$\{(\w+)\}/g)].map(name => name[1]))
        .filter(name => fragments.has(name));
    return [...new Set(spliced)].map(name => `${relative(srcDir, file)}: ${name}`);
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

    // #5482 — a ternary outside `<Trans>`, such as `{n} item{n !== 1 ? 's' : ''}`, is never
    // extracted, so the check above cannot see it.
    it('does not choose an English plural with a ternary on the count in components', () => {
        const handRolled = [...tsxFiles(join(srcDir, 'app')), ...tsxFiles(join(srcDir, 'lib'))].flatMap(
            countTernaryLines,
        );
        expect(handRolled, 'use <Plural> or plural() instead of a ternary on the count').toEqual([]);
    });

    // #5482 — a translated fragment such as `t\`top level\`` dropped into a plural message
    // leaves translators with half a sentence they cannot inflect or reorder.
    it('does not splice translated fragments into plural messages', () => {
        const spliced = [...tsxFiles(join(srcDir, 'app')), ...tsxFiles(join(srcDir, 'lib'))].flatMap(
            splicedFragments,
        );
        expect(spliced, 'give each case its own complete message').toEqual([]);
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
