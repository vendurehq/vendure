import { Kind, parse } from 'graphql';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * #5463 — the order lines table on the order detail page builds its columns from the
 * fields selected by the `OrderLine` fragment, and resolves each label through
 * `getTranslatedFieldName`, which looks up `fieldName.<field>` and falls back to
 * `camelCaseToTitleCase` when the id is absent from the catalog. A field with no
 * `fieldName.*` key therefore renders title-cased English in every locale, both in the
 * column settings menu and in the header of any column without a custom `<Trans>`.
 *
 * The field list is derived from the fragment rather than hardcoded, so adding a field
 * to the fragment without a translation key fails here instead of silently shipping an
 * untranslatable column. Every catalog is checked because `fieldName.*` is one of the
 * namespaces that is fully populated in all locales; `i18n:check` only finds empty
 * msgstr values, never a key that was left out of `common-strings.ts` altogether.
 */

const i18nDir = dirname(fileURLToPath(import.meta.url));
const localesDir = join(i18nDir, 'locales');
const orderLineFragmentSource = join(i18nDir, '../app/routes/_authenticated/_orders/orders.graphql.ts');

/** Extract the `fragment OrderLine on OrderLine { ... }` block from its surrounding TypeScript. */
function extractOrderLineFragment(): string {
    const source = readFileSync(orderLineFragmentSource, 'utf-8');
    const start = source.indexOf('fragment OrderLine on OrderLine {');
    expect(start, 'OrderLine fragment not found in orders.graphql.ts').toBeGreaterThan(-1);
    let depth = 0;
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++;
        if (source[i] === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(start, i + 1);
            }
        }
    }
    throw new Error('Unbalanced braces in the OrderLine fragment');
}

/** The top-level field names the fragment selects, which are the table's column ids. */
function orderLineColumnIds(): string[] {
    const definition = parse(extractOrderLineFragment()).definitions[0];
    if (definition.kind !== Kind.FRAGMENT_DEFINITION) {
        throw new Error(`Expected a FragmentDefinition, got ${definition.kind}`);
    }
    return definition.selectionSet.selections
        .filter(selection => selection.kind === Kind.FIELD)
        .map(selection => selection.name.value);
}

/** The `fieldName.*` ids declared for extraction in common-strings.ts. */
function declaredFieldNameIds(): Set<string> {
    const source = readFileSync(join(i18nDir, 'common-strings.ts'), 'utf-8');
    return new Set([...source.matchAll(/'fieldName\.([A-Za-z0-9_]+)'/g)].map(match => match[1]));
}

/** msgid -> msgstr for one catalog. No `fieldName.*` label is long enough for po line wrapping. */
function catalogEntries(locale: string): Map<string, string> {
    const content = readFileSync(join(localesDir, `${locale}.po`), 'utf-8');
    const pattern = /^msgid "((?:[^"\\]|\\.)*)"\nmsgstr "((?:[^"\\]|\\.)*)"$/gm;
    return new Map([...content.matchAll(pattern)].map(match => [match[1], match[2]]));
}

const locales = readdirSync(localesDir)
    .filter(file => file.endsWith('.po'))
    .map(file => file.slice(0, -3))
    .sort();

describe('order line column names are translatable', () => {
    const columnIds = orderLineColumnIds();

    it('finds the fields the order lines table renders as columns', () => {
        // Guards the extraction above: if the fragment is restructured so that no fields
        // are found, every assertion below would pass vacuously.
        expect(columnIds).toContain('unitPriceWithTax');
        expect(columnIds.length).toBeGreaterThan(10);
        expect(locales).toContain('en');
    });

    it('declares a fieldName.* key for every field the fragment selects', () => {
        const declared = declaredFieldNameIds();
        const missing = columnIds.filter(id => !declared.has(id));
        expect(missing, 'missing from the fieldName list in common-strings.ts').toEqual([]);
    });

    it.each(locales)('has a non-empty %s translation for every column name', locale => {
        const entries = catalogEntries(locale);
        const untranslated = columnIds.filter(id => !entries.get(`fieldName.${id}`));
        expect(untranslated, `missing or empty in locales/${locale}.po`).toEqual([]);
    });
});
