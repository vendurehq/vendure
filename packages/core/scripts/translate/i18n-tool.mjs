#!/usr/bin/env node

/**
 * Extracts the translatable strings of every core ConfigurableOperationDef, and applies
 * LLM-produced translations back into `src/i18n/messages/<lng>.json`.
 *
 * Usage:
 *   node scripts/translate/i18n-tool.mjs extract [output-file]
 *   node scripts/translate/i18n-tool.mjs apply <translations-file>
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ALLOWED_SCRIPTS,
    REQUIRED_SCRIPTS,
    SCRIPT_RANGES,
    looksTrivial,
} from '../../../dashboard/scripts/translate/locale-profiles.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CORE_DIST = path.resolve(__dirname, '../../dist/index.js');
const CORE_REGISTRY = path.resolve(__dirname, '../../dist/config/configurable-operation-registry.js');
const MESSAGES_DIR = path.resolve(__dirname, '../../src/i18n/messages');
/** The dashboard's catalogs are the canonical list of locales Vendure supports. */
const DASHBOARD_LOCALES_DIR = path.resolve(__dirname, '../../../dashboard/src/i18n/locales');
const NAMESPACE = 'configurableOperation';
const SOURCE_LANGUAGE = 'en';

/**
 * Every ConfigurableOperationDef shipped by core, with its registry assigned. The registries come
 * from the same helper the server bootstrap uses, so the two cannot list different operations.
 * `defaultConfig` has the shape that helper reads. `dummyPaymentHandler` and `examplePaymentHandler`
 * are exported for use in development but are absent from `defaultConfig`, so they are added here.
 */
function getCoreOperations() {
    if (!fs.existsSync(CORE_DIST)) {
        console.error(`Could not find ${CORE_DIST}. Run \`npm run build\` in packages/core first.`);
        process.exit(1);
    }
    const core = require(CORE_DIST);
    const { getConfigurableOperationDefinitions } = require(CORE_REGISTRY);
    const registries = getConfigurableOperationDefinitions(core.defaultConfig);

    const extraHandlerNames = ['dummyPaymentHandler', 'examplePaymentHandler'];
    const missing = extraHandlerNames.filter(name => !core[name]);
    if (missing.length) {
        console.error(
            `@vendure/core no longer exports ${missing.join(', ')}. Update this script, otherwise ` +
                'their strings are dropped from every batch without anyone noticing.',
        );
        process.exit(1);
    }
    registries.PaymentMethodHandler = [
        ...registries.PaymentMethodHandler,
        ...extraHandlerNames.map(name => core[name]),
    ];

    const operations = [];
    for (const [defType, defs] of Object.entries(registries)) {
        for (const def of defs) {
            def.setDefType(defType);
            operations.push(def);
        }
    }
    return operations;
}

/** The translatable strings of every core operation which has an English source value. */
function getTranslatableStrings() {
    return getCoreOperations()
        .flatMap(operation => operation.getTranslationKeys())
        .filter(entry => entry.sourceValue);
}

function getTargetLanguages() {
    return fs
        .readdirSync(DASHBOARD_LOCALES_DIR)
        .filter(file => file.endsWith('.po'))
        .map(file => file.slice(0, -3))
        .filter(lang => lang !== SOURCE_LANGUAGE)
        .sort();
}

function readCatalog(lang) {
    const filePath = path.join(MESSAGES_DIR, `${lang}.json`);
    return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : {};
}

function writeCatalog(lang, catalog) {
    fs.writeFileSync(
        path.join(MESSAGES_DIR, `${lang}.json`),
        JSON.stringify(catalog, null, 2) + '\n',
        'utf-8',
    );
}

function getAtPath(root, keyPath) {
    let node = root;
    for (const segment of keyPath) {
        if (node == null || typeof node !== 'object') {
            return undefined;
        }
        node = node[segment];
    }
    return typeof node === 'string' ? node : undefined;
}

function setAtPath(root, keyPath, value) {
    let node = root;
    for (const segment of keyPath.slice(0, -1)) {
        if (typeof node[segment] !== 'object' || node[segment] === null) {
            node[segment] = {};
        }
        node = node[segment];
    }
    node[keyPath[keyPath.length - 1]] = value;
}

/**
 * The distinct English strings which have no translation yet in the given language. Keying by the
 * source string rather than by the key path both dedupes the batch sent to the LLM and avoids
 * having to escape operation codes, which may themselves contain dots.
 */
function getMissingSourceStrings(lang, entries) {
    const catalog = readCatalog(lang)[NAMESPACE];
    const missing = new Set();
    for (const { keyPath, sourceValue } of entries) {
        if (getAtPath(catalog, keyPath) === undefined) {
            missing.add(sourceValue);
        }
    }
    return [...missing];
}

function extract(outputFile = 'missing-translations.txt') {
    const entries = getTranslatableStrings();
    const languages = getTargetLanguages();
    console.log(`${entries.length} translatable strings across ${languages.length} languages\n`);

    const missingByLanguage = {};
    let total = 0;
    for (const lang of languages) {
        const missing = getMissingSourceStrings(lang, entries);
        console.log(`${lang}: ${missing.length} missing`);
        if (missing.length) {
            missingByLanguage[lang] = missing;
            total += missing.length;
        }
    }

    const lines = [
        '# Translation Request for Vendure Core Configurable Operations',
        '',
        'These are the descriptions and argument labels of the promotion conditions, shipping',
        'calculators, collection filters and payment handlers shown in the Vendure admin UI.',
        'Assume an e-commerce context throughout.',
        '',
        '## Instructions:',
        '1. Translate each source string into the target language',
        '2. Reproduce placeholders such as `{ discount }` and `{ facetValueNames }` exactly, including the spaces inside the braces. They are substituted with live values by the admin UI, so a renamed or reformatted placeholder will not be replaced.',
        '3. Leave technical terms such as "SKU", "API" and "GraphQL" untranslated',
        '4. Use formal address, as is appropriate for business software',
        '5. Return the translations in the exact format shown below',
        '',
        '## Expected Output Format:',
        '```',
        'language_code',
        'source_text|translated_text',
        'source_text|translated_text',
        '---',
        'language_code',
        'source_text|translated_text',
        '---',
        '```',
        '',
        '## Missing Translations:',
        '',
    ];
    for (const [lang, sources] of Object.entries(missingByLanguage)) {
        lines.push(lang, ...sources, '---');
    }

    const outputPath = path.resolve(outputFile);
    fs.writeFileSync(outputPath, lines.join('\n'), 'utf-8');
    console.log(`\n${total} missing translations written to ${outputPath}`);
    console.log('Next: paste the file into an LLM, save the reply, then run:');
    console.log(`  node scripts/translate/i18n-tool.mjs apply <reply-file>`);
}

/**
 * Refuses a batch whose strings do not look like they belong to the target language. Guards against
 * an LLM mislabelling a block, which would otherwise silently write e.g. Arabic into the Croatian
 * catalog. Shared with the dashboard tooling so the two cannot disagree on what counts as a
 * violation.
 */
function findScriptViolations(lang, translations) {
    const violations = [];
    const required = REQUIRED_SCRIPTS[lang];
    const allowed = new Set(ALLOWED_SCRIPTS[lang] ?? []);

    for (const [source, translation] of Object.entries(translations)) {
        if (looksTrivial(translation)) {
            continue;
        }
        if (required && ![...translation].some(char => required.test(char))) {
            violations.push(`${source} -> ${translation} (missing ${required.name} characters)`);
            continue;
        }
        for (const [scriptName, matcher] of Object.entries(SCRIPT_RANGES)) {
            if (!allowed.has(scriptName) && matcher.test(translation)) {
                violations.push(`${source} -> ${translation} (contains ${scriptName} characters)`);
                break;
            }
        }
    }
    return violations;
}

function parseTranslationsFile(filePath) {
    const byLanguage = {};
    for (const block of fs.readFileSync(filePath, 'utf-8').split(/\n---\n?/)) {
        const lines = block.trim().split('\n').filter(Boolean);
        if (lines.length < 2) {
            continue;
        }
        const lang = lines[0].trim();
        const translations = {};
        for (const line of lines.slice(1)) {
            const separator = line.lastIndexOf('|');
            if (separator === -1) {
                console.warn(`Skipping malformed line for ${lang}: ${line}`);
                continue;
            }
            translations[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
        }
        byLanguage[lang] = translations;
    }
    return byLanguage;
}

function apply(translationsFile) {
    if (!translationsFile || !fs.existsSync(translationsFile)) {
        console.error(`Translations file not found: ${translationsFile ?? '<none given>'}`);
        process.exit(1);
    }
    const entries = getTranslatableStrings();
    const byLanguage = parseTranslationsFile(translationsFile);
    const knownLanguages = new Set(getTargetLanguages());

    for (const [lang, translations] of Object.entries(byLanguage)) {
        if (!knownLanguages.has(lang)) {
            console.error(`Refusing unknown language "${lang}" — no such dashboard locale.`);
            process.exit(1);
        }
        const violations = findScriptViolations(lang, translations);
        if (violations.length) {
            console.error(`Refusing the ${lang} block, which does not look like ${lang}:`);
            violations.forEach(violation => console.error(`  ${violation}`));
            process.exit(1);
        }
    }

    for (const [lang, translations] of Object.entries(byLanguage)) {
        const catalog = readCatalog(lang);
        catalog[NAMESPACE] ??= {};
        let written = 0;
        for (const { keyPath, sourceValue } of entries) {
            const translation = translations[sourceValue];
            if (translation && getAtPath(catalog[NAMESPACE], keyPath) === undefined) {
                setAtPath(catalog[NAMESPACE], keyPath, translation);
                written++;
            }
        }
        writeCatalog(lang, catalog);
        console.log(`${lang}: wrote ${written} keys from ${Object.keys(translations).length} strings`);
    }
}

const [command, argument] = process.argv.slice(2);
switch (command) {
    case 'extract':
        extract(argument);
        break;
    case 'apply':
        apply(argument);
        break;
    default:
        console.error('Usage: i18n-tool.mjs extract [output-file] | apply <translations-file>');
        process.exit(1);
}
