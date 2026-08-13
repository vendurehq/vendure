#!/usr/bin/env node

/**
 * Random spot-check sampler for translation correctness.
 *
 * Heuristic audits catch the obvious (script mismatches, cross-locale
 * leaks). They miss subtle cases — e.g. an Italian msgstr that's
 * grammatically Italian but actually mistranslated, or French that's
 * lifted into a Spanish file but happens to share enough cognates that
 * no character-level signal fires.
 *
 * This tool picks N random non-empty msgstrs from each locale and writes
 * them to spot-check-out/<locale>-batch-<n>.json. A verifier agent
 * (or human) then reads each batch and judges: is this string actually
 * in <locale>?
 *
 * The batch index is persisted in a state file so successive runs cover
 * different entries — run on a /loop and you progressively expand
 * coverage of the catalog without re-checking the same strings.
 *
 * Usage:
 *   node scripts/translate/spot-check.js               # default 20 per locale
 *   node scripts/translate/spot-check.js --sample=50
 *   node scripts/translate/spot-check.js --locale=it
 *   node scripts/translate/spot-check.js --reset      # forget coverage state
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parsePOFile } from './locale-profiles.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOCALES_DIR = path.resolve(__dirname, '../../src/i18n/locales');
const OUT_DIR = path.resolve(__dirname, 'spot-check-out');
const STATE_FILE = path.join(OUT_DIR, '.coverage-state.json');

const EXCLUDE = new Set(['en', 'sv']);

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return { coverage: {} };
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    } catch {
        return { coverage: {} };
    }
}

function saveState(state) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Knuth-shuffle a copy. We use Math.random — predictable cross-run
 * randomness isn't needed.
 */
function shuffled(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function main() {
    const args = process.argv.slice(2);
    if (args.includes('--reset')) {
        if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
        console.log('Coverage state cleared.');
        return;
    }
    const sampleSize = parseInt(args.find(a => a.startsWith('--sample='))?.split('=')[1] ?? '20', 10);
    const onlyLocale = args.find(a => a.startsWith('--locale='))?.split('=')[1];

    const localeFiles = fs.readdirSync(LOCALES_DIR)
        .filter(f => f.endsWith('.po'))
        .map(f => f.slice(0, -3))
        .filter(l => !EXCLUDE.has(l))
        .sort();

    const targets = onlyLocale ? [onlyLocale] : localeFiles;
    const state = loadState();
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const manifest = { generatedAt: new Date().toISOString(), sampleSize, batches: [] };

    for (const loc of targets) {
        const entries = parsePOFile(path.join(LOCALES_DIR, `${loc}.po`));
        // Filter to entries with a non-empty msgstr — empty translations
        // carry no language signal and aren't useful spot-check fodder.
        const filled = entries.filter(e => e.msgstr !== '');
        // Coverage is keyed by stable entry id (msgctxt + msgid), NOT
        // line number — line numbers shift whenever the .po is
        // regenerated or rewrapped, which would silently invalidate
        // every previously-covered entry.
        const prev = state.coverage[loc] ?? { coveredIds: [], batchCount: 0 };
        const covered = new Set(prev.coveredIds);
        const remaining = filled.filter(e => !covered.has(e.id));
        if (remaining.length === 0) {
            console.log(`${loc}: 100% covered (${filled.length} entries) — skipping.`);
            continue;
        }

        const sample = shuffled(remaining).slice(0, sampleSize);
        const batchIdx = prev.batchCount + 1;
        const batchPath = path.join(OUT_DIR, `${loc}-batch-${String(batchIdx).padStart(3, '0')}.json`);

        const batch = {
            locale: loc,
            batchIndex: batchIdx,
            sampledFromRemaining: remaining.length,
            totalEntries: filled.length,
            samples: sample.map(e => ({
                id: e.id,
                line: e.msgstrLine,
                msgctxt: e.msgctxt,
                msgid: e.msgid,
                msgstr: e.msgstr,
                verdict: null,           // verifier fills: 'ok' | 'wrong-language' | 'mistranslation' | 'unsure'
                note: null,              // verifier fills: explanation if not 'ok'
                suggestedFix: null,      // verifier fills: corrected msgstr if applicable
            })),
        };
        fs.writeFileSync(batchPath, JSON.stringify(batch, null, 2));

        state.coverage[loc] = {
            coveredIds: [...covered, ...sample.map(e => e.id)],
            batchCount: batchIdx,
        };
        manifest.batches.push({ locale: loc, file: path.relative(OUT_DIR, batchPath), count: sample.length });

        console.log(`${loc}: sampled ${sample.length} (covered ${covered.size + sample.length}/${filled.length}).`);
    }

    saveState(state);
    fs.writeFileSync(path.join(OUT_DIR, 'latest-manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`\nManifest: ${path.join(OUT_DIR, 'latest-manifest.json')}`);
    console.log('Verifier agent should read each batch JSON, fill in verdict/note/suggestedFix per sample, and write back.');
}

main();
