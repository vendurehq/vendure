#!/usr/bin/env node

/**
 * Audits PO files for wrong-language msgstr values.
 *
 * Three independent signals are combined per entry:
 *
 *   1. CROSS_LOCALE_MATCH — msgstr appears verbatim in a different locale's
 *      msgstr for the same msgid (or even a different msgid). This is the
 *      strongest signal: it's how the original Swedish/Polish leak in #4684
 *      was found.
 *
 *   2. SCRIPT_MISMATCH — for locales whose script is unambiguous (Arabic,
 *      Hebrew, Cyrillic, CJK, Hangul, Devanagari), an msgstr with substantial
 *      Latin content and no native-script characters is almost certainly
 *      either copy-pasted English or a wrong-language insertion.
 *
 *   3. DISTINCTIVE_CHARS — for Latin-script locales, msgstrs that contain
 *      characters distinctive to a *different* Latin language (e.g. Polish ą,
 *      ł, ę in an Italian file) are flagged.
 *
 * Output:
 *   - audit-report.json : full machine-readable report (used by subagents)
 *   - per-locale .txt files in audit-out/ : human-readable triage lists
 *
 * Usage:
 *   node scripts/translate/audit-translations.js
 *   node scripts/translate/audit-translations.js --locale=it
 *   node scripts/translate/audit-translations.js --min-confidence=2
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    ALLOWED_SCRIPTS,
    REQUIRED_SCRIPTS,
    SCRIPT_RANGES,
    entryId,
    looksTrivial,
    parsePOFile,
} from './locale-profiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.resolve(__dirname, '../../src/i18n/locales');
const OUT_DIR = path.resolve(__dirname, 'audit-out');

// Locales to exclude from cross-locale comparison entirely. Currently
// only contains `sv` because PR #4684 is fixing a known Polish-content
// contamination there; including its known-bad msgstrs would surface
// false matches against Polish for every other locale we audit.
//
// REMOVE once #4684 lands.
const EXCLUDE_LOCALES = new Set(['sv']);

// ---------------------------------------------------------------------------
// Language profile data
//
// Most script tables (REQUIRED_SCRIPTS, SCRIPT_RANGES, ALLOWED_SCRIPTS)
// are imported from `./locale-profiles.js`. The Latin-script-specific
// data below (locale families, overlap groups, exclusive-character
// hints) lives here because it's only needed by the auditor, not by the
// apply-time guard or the spot-check sampler.
// ---------------------------------------------------------------------------

// Alias for clarity at call sites — REQUIRED_SCRIPTS is what we check
// against when auditing a non-Latin locale.
const SCRIPT_EXPECTATIONS = REQUIRED_SCRIPTS;

// Locale family groups. Members within a family legitimately share many
// translations (regional variants of the same language) and cross-locale
// matches between siblings should NOT be flagged.
const LOCALE_FAMILY = {
    pt_BR: 'pt', pt_PT: 'pt',
    zh_Hans: 'zh', zh_Hant: 'zh',
    // sv & nb are distinct languages but share enough vocab that
    // identical msgstrs are not by themselves suspicious. They were
    // explicitly excluded from each other's diagnostic in PR #4684.
    sv: 'nordic', nb: 'nordic',
    // Cyrillic Slavic languages — distinct but share many cognates &
    // technical loanwords. We only flag cross-matches between them when
    // the msgstr is reasonably long.
    ru: 'cyr-slavic', bg: 'cyr-slavic', uk: 'cyr-slavic',
};

function sameFamily(a, b) {
    if (a === b) return true;
    const fa = LOCALE_FAMILY[a];
    const fb = LOCALE_FAMILY[b];
    return fa !== undefined && fa === fb;
}

// Locale groups that share enough vocabulary that a *short* matching
// msgstr is more likely a cognate than a translation error. Cross-locale
// matches between members of the same overlap group are gated on length
// (≥ 25 characters) or on additional confirming signals.
//
// Note: ru/bg/uk also appear in LOCALE_FAMILY ('cyr-slavic'), which
// suppresses cross-locale matches between them entirely (regardless of
// length). The overlap-group entry is therefore dead code for that
// triple — but listed here for completeness and so that future edits
// can't accidentally weaken protection by removing the family link
// without also reinstating the overlap-group treatment.
const OVERLAP_GROUPS = [
    new Set(['es', 'pt_BR', 'pt_PT', 'it', 'fr', 'ro']),       // Romance
    new Set(['de', 'nl', 'nb', 'sv']),                          // Germanic
    new Set(['cs', 'pl', 'hr']),                                // Slavic Latin
    new Set(['ru', 'bg', 'uk']),                                // Slavic Cyrillic
];

function inSameOverlapGroup(a, b) {
    return OVERLAP_GROUPS.some(g => g.has(a) && g.has(b));
}

const SHORT_MATCH_THRESHOLD = 25;

// EXCLUSIVE characters: characters whose presence in an msgstr is a strong
// indicator of a specific Latin-script language. "Exclusive" here means
// they don't appear in everyday spelling of most other Latin-script
// languages used in Vendure's locale set.
//
// Trade-off: if X is in EXCLUSIVE[lang], then finding X in any locale
// other than `lang` (or its family members) is suspicious.
// Each entry contains characters whose presence is a strong indicator of
// the named language *within Vendure's locale set*. Crucially we only
// include chars that DON'T appear in the everyday spelling of any OTHER
// supported locale — otherwise we get false positives (e.g. ć appears in
// both Polish and Croatian).
const EXCLUSIVE_CHARS = {
    pl: { chars: 'ąęłńśźżĄĘŁŃŚŹŻ', label: 'Polish' },
    cs: { chars: 'řůŘŮ', label: 'Czech (ř/ů)' },
    hu: { chars: 'őűŐŰ', label: 'Hungarian' },
    ro: { chars: 'șțȘȚ', label: 'Romanian (with comma below)' },
    hr: { chars: 'đĐ', label: 'Croatian/Serbian' },
    de: { chars: 'ßẞ', label: 'German' },
    es: { chars: '¿¡ñÑ', label: 'Spanish' },
    pt: { chars: 'ãõÃÕ', label: 'Portuguese' },
    fr: { chars: 'œŒæÆ', label: 'French' },
    tr: { chars: 'ğĞİ', label: 'Turkish' },
    nordic: { chars: 'åÅøØ', label: 'Nordic' },
};

// Map locale → which exclusive-char groups belong to *this* locale (so we
// don't flag a Spanish msgstr for containing 'ñ').
const OWN_EXCLUSIVE = {
    pl: ['pl'],
    cs: ['cs'],
    hu: ['hu'],
    ro: ['ro'],
    hr: ['hr'],
    de: ['de'],
    es: ['es'],
    pt_BR: ['pt'],
    pt_PT: ['pt'],
    fr: ['fr'],
    tr: ['tr'],
    sv: ['nordic'],
    nb: ['nordic'],
    nl: [],
    it: [],
    en: [],
};

// ---------------------------------------------------------------------------
// Heuristics
// ---------------------------------------------------------------------------

const LATIN_RE = /[A-Za-zÀ-ÿĀ-ſ]/;

/**
 * Returns the set of EXCLUSIVE_CHARS group keys whose chars appear in s but
 * which do NOT belong to ownLocale. These are strong wrong-language signals.
 */
function foreignExclusiveHits(s, ownLocale) {
    const hits = new Set();
    const own = new Set(OWN_EXCLUSIVE[ownLocale] ?? []);
    for (const [key, profile] of Object.entries(EXCLUSIVE_CHARS)) {
        if (own.has(key)) continue;
        for (const ch of s) {
            if (profile.chars.includes(ch)) {
                hits.add(key);
                break;
            }
        }
    }
    return hits;
}

/**
 * Returns true if msgstr is entirely Latin-script (substantial content) and
 * the expected locale uses a non-Latin script.
 */
function scriptMismatch(s, locale) {
    const expect = SCRIPT_EXPECTATIONS[locale];
    if (!expect) return false;
    if (looksTrivial(s)) return false;
    let latinCount = 0;
    let nativeCount = 0;
    for (const ch of s) {
        if (LATIN_RE.test(ch)) latinCount++;
        if (expect.test(ch)) nativeCount++;
    }
    // Substantial Latin content with no native-script chars at all
    return nativeCount === 0 && latinCount >= 4;
}

/**
 * Detects msgstrs containing characters from a script that doesn't belong
 * to this locale at all (e.g. Arabic chars in hr.po, CJK in nb.po,
 * Cyrillic in tr.po). Returns the foreign script name(s), or null.
 */
function foreignScriptHits(s, locale) {
    if (looksTrivial(s)) return null;
    const allowed = new Set(ALLOWED_SCRIPTS[locale] ?? []);
    const hits = new Set();
    for (const [name, re] of Object.entries(SCRIPT_RANGES)) {
        if (allowed.has(name)) continue;
        if (re.test(s)) hits.add(name);
    }
    return hits.size ? [...hits] : null;
}

/**
 * Quick check: does the msgstr's script profile look compatible with the
 * given locale? Used to disambiguate cross-locale matches — a Japanese
 * msgstr that legitimately appears in ja.po should NOT be flagged just
 * because nb.po has accidentally been polluted with the same Japanese
 * string.
 *
 * For Latin-script locales we have no firm script expectation, so we
 * always return true (cross-locale match alone is the signal).
 */
function looksCompatibleWithLocale(s, locale) {
    const expect = SCRIPT_EXPECTATIONS[locale];
    if (!expect) return true; // Latin-script locale — no script gate
    if (looksTrivial(s)) return true;
    return [...s].some(ch => expect.test(ch));
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

function main() {
    const args = process.argv.slice(2);
    const onlyLocale = args.find(a => a.startsWith('--locale='))?.split('=')[1];
    const minConfidence = parseInt(args.find(a => a.startsWith('--min-confidence='))?.split('=')[1] ?? '1', 10);

    const localeFiles = fs
        .readdirSync(LOCALES_DIR)
        .filter(f => f.endsWith('.po'))
        .map(f => f.slice(0, -3))
        .sort();

    // Parse every locale once
    const parsed = {};
    for (const loc of localeFiles) {
        parsed[loc] = parsePOFile(path.join(LOCALES_DIR, `${loc}.po`));
    }

    // Build a reverse index: msgstr -> [{ locale, entry }, ...]
    // Skip trivial msgstrs to keep the index small and reduce noise.
    const reverseIndex = new Map();
    for (const loc of localeFiles) {
        if (loc === 'en' || EXCLUDE_LOCALES.has(loc)) continue;
        for (const e of parsed[loc]) {
            if (!e.msgstr || looksTrivial(e.msgstr)) continue;
            const key = e.msgstr.trim();
            if (!reverseIndex.has(key)) reverseIndex.set(key, []);
            reverseIndex.get(key).push({ locale: loc, msgid: e.msgid });
        }
    }

    // For cross-locale matching, we ALSO want a same-msgid index so we can
    // detect "the msgstr in locale X equals the msgstr for the same msgid
    // in locale Y" — even cleaner signal.
    const byMsgidLocale = {};
    for (const loc of localeFiles) {
        byMsgidLocale[loc] = new Map();
        if (EXCLUDE_LOCALES.has(loc)) continue;
        for (const e of parsed[loc]) {
            if (e.msgstr) byMsgidLocale[loc].set(e.id, e.msgstr.trim());
        }
    }

    const report = { generatedAt: new Date().toISOString(), locales: {} };
    const targets = onlyLocale
        ? [onlyLocale]
        : localeFiles.filter(l => l !== 'en' && !EXCLUDE_LOCALES.has(l));

    for (const loc of targets) {
        const findings = [];
        for (const e of parsed[loc]) {
            if (!e.msgstr || looksTrivial(e.msgstr)) continue;
            // Skip entries where msgstr equals msgid (untranslated — separate concern)
            if (e.msgstr === e.msgid) continue;

            const signals = [];
            const key = e.msgstr.trim();

            // Gate cross-locale signals on "string is compatible with my
            // own locale's script". This stops genuine Japanese in ja.po
            // from being flagged just because nb.po has been polluted
            // with the same string.
            const compatibleWithOwn = looksCompatibleWithLocale(key, loc);

            // SIGNAL 1: msgstr matches the msgstr for the same msgid in a
            // non-sibling locale. For locale pairs in OVERLAP_GROUPS
            // (Romance, Germanic, Slavic) we additionally require the
            // string to be longer than SHORT_MATCH_THRESHOLD, since these
            // language groups share many short cognates ("Tipo", "Editar",
            // "Filtrar"...) that are legitimately the same.
            const sameMsgidMatches = [];
            for (const other of localeFiles) {
                if (other === loc || other === 'en') continue;
                if (EXCLUDE_LOCALES.has(other)) continue;
                if (sameFamily(loc, other)) continue;
                const otherStr = byMsgidLocale[other].get(e.id);
                if (!otherStr || otherStr !== key) continue;
                if (inSameOverlapGroup(loc, other) && key.length < SHORT_MATCH_THRESHOLD) continue;
                sameMsgidMatches.push(other);
            }
            // Only flag if the msgstr does NOT fit the current locale's
            // expected script. Otherwise we'd flag e.g. ar.po's correct
            // Arabic msgstrs just because hr.po contains the same strings
            // (when hr.po is the side that's actually wrong).
            // For Latin-script locales (no script expectation) we have no
            // way to disambiguate, so we still flag — agent reviewer judges.
            if (sameMsgidMatches.length && (!compatibleWithOwn || !SCRIPT_EXPECTATIONS[loc])) {
                signals.push({ kind: 'CROSS_LOCALE_SAME_MSGID', otherLocales: sameMsgidMatches });
            }

            // SIGNAL 2: msgstr appears verbatim in a non-sibling locale's
            // catalogue (any msgid). Weaker than signal 1 — we require
            // ≥ 12 characters, and skip when both sides are in the same
            // overlap group unless ≥ SHORT_MATCH_THRESHOLD chars.
            if (key.length >= 12 && !sameMsgidMatches.length) {
                const matches = reverseIndex.get(key) ?? [];
                const otherLocales = [
                    ...new Set(
                        matches
                            .map(m => m.locale)
                            .filter(
                                l =>
                                    l !== loc &&
                                    !sameFamily(loc, l) &&
                                    !EXCLUDE_LOCALES.has(l) &&
                                    !(inSameOverlapGroup(loc, l) && key.length < SHORT_MATCH_THRESHOLD),
                            ),
                    ),
                ];
                if (otherLocales.length && (!compatibleWithOwn || !SCRIPT_EXPECTATIONS[loc])) {
                    signals.push({ kind: 'CROSS_LOCALE_VERBATIM', otherLocales });
                }
            }

            // SIGNAL 3: msgstr contains characters exclusive to a *foreign*
            // Latin language.
            const foreignHits = foreignExclusiveHits(key, loc);
            for (const fh of foreignHits) {
                signals.push({ kind: 'FOREIGN_EXCLUSIVE_CHARS', langGroup: fh });
            }

            // SIGNAL 4: msgstr is purely Latin in a non-Latin-script locale
            if (scriptMismatch(key, loc)) {
                signals.push({ kind: 'SCRIPT_MISMATCH', expected: SCRIPT_EXPECTATIONS[loc].name });
            }

            // SIGNAL 5: msgstr contains characters from a script that
            // doesn't belong to this locale at all (e.g. Arabic in hr.po,
            // CJK in nb.po, Cyrillic in tr.po). Highest-confidence signal.
            const foreign = foreignScriptHits(key, loc);
            if (foreign) {
                signals.push({ kind: 'FOREIGN_SCRIPT', scripts: foreign });
            }

            if (signals.length >= minConfidence) {
                findings.push({
                    msgstrLine: e.msgstrLine,
                    msgid: e.msgid,
                    msgstr: e.msgstr,
                    signals,
                });
            }
        }

        // Sort by signal count desc, then by line
        findings.sort((a, b) => b.signals.length - a.signals.length || a.msgstrLine - b.msgstrLine);
        report.locales[loc] = { count: findings.length, findings };
    }

    // Write JSON report
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const jsonPath = path.join(OUT_DIR, 'audit-report.json');
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

    // Write per-locale .txt summaries for human review
    for (const [loc, { count, findings }] of Object.entries(report.locales)) {
        const lines = [`# ${loc}.po — ${count} suspicious entries`, ''];
        for (const f of findings) {
            const sigSummary = f.signals
                .map(s => {
                    const detail =
                        s.otherLocales ? `(${s.otherLocales.join('/')})` :
                        s.langGroup ? `(${s.langGroup})` :
                        s.scripts ? `(${s.scripts.join('/')})` :
                        s.expected ? `(${s.expected})` : '';
                    return s.kind + detail;
                })
                .join(', ');
            lines.push(`L${f.msgstrLine}  [${sigSummary}]`);
            lines.push(`  msgid:  ${f.msgid}`);
            lines.push(`  msgstr: ${f.msgstr}`);
            lines.push('');
        }
        fs.writeFileSync(path.join(OUT_DIR, `${loc}.txt`), lines.join('\n'));
    }

    // Console summary
    console.log('Audit complete.\n');
    console.log('Locale  Suspicious');
    console.log('------  ----------');
    for (const [loc, { count }] of Object.entries(report.locales)) {
        console.log(`${loc.padEnd(7)} ${count}`);
    }
    console.log(`\nReport: ${jsonPath}`);
    console.log(`Per-locale lists: ${OUT_DIR}/<locale>.txt`);
}

main();
