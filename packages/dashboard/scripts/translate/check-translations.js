#!/usr/bin/env node

/**
 * This script checks that all translations are present in all locale files.
 * It exits with code 1 if any translations are missing, making it suitable for CI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_LOCALES_DIR = '../../src/i18n/locales';

function getSupportedLanguages(localesDir) {
    const files = fs.readdirSync(localesDir);
    return files
        .filter(file => file.endsWith('.po'))
        .map(file => file.slice(0, -3))
        .filter(lang => lang !== 'en')
        .sort();
}

function parsePOFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const missingMsgids = [];

    const entries = content.split(/\n\s*\n/);

    for (const entry of entries) {
        const lines = entry.trim().split('\n');
        if (!lines.length) continue;

        const msgidLines = [];
        const msgstrLines = [];
        let currentSection = null;

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.startsWith('#')) {
                continue;
            } else if (trimmedLine.startsWith('msgid ')) {
                currentSection = 'msgid';
                msgidLines.push(trimmedLine.slice(6));
            } else if (trimmedLine.startsWith('msgstr ')) {
                currentSection = 'msgstr';
                msgstrLines.push(trimmedLine.slice(7));
            } else if (trimmedLine.startsWith('"') && currentSection) {
                if (currentSection === 'msgid') {
                    msgidLines.push(trimmedLine);
                } else if (currentSection === 'msgstr') {
                    msgstrLines.push(trimmedLine);
                }
            }
        }

        if (msgidLines.length && msgstrLines.length) {
            const msgstrContent = msgstrLines.join('');
            if (msgstrContent === '""' || msgstrContent === '') {
                const msgidContent = msgidLines.join('');
                if (msgidContent.startsWith('"') && msgidContent.endsWith('"')) {
                    const msgidText = msgidContent.slice(1, -1);
                    const unescapedText = msgidText
                        .replace(/\\"/g, '"')
                        .replace(/\\n/g, '\n')
                        .replace(/\\\\/g, '\\');

                    if (unescapedText) {
                        missingMsgids.push(unescapedText);
                    }
                }
            }
        }
    }

    return missingMsgids;
}

function checkTranslations(localesDir = DEFAULT_LOCALES_DIR) {
    const localesPath = path.resolve(__dirname, localesDir);

    if (!fs.existsSync(localesPath)) {
        console.error(`Locales directory not found: ${localesPath}`);
        process.exit(1);
    }

    console.log('Checking for missing translations...\n');

    const supportedLanguages = getSupportedLanguages(localesPath);
    let totalMissing = 0;
    const languagesWithMissing = [];

    for (const lang of supportedLanguages) {
        const poFilePath = path.join(localesPath, `${lang}.po`);

        if (!fs.existsSync(poFilePath)) {
            console.warn(`Warning: .po file not found for ${lang}`);
            continue;
        }

        const missingMsgids = parsePOFile(poFilePath);
        if (missingMsgids.length > 0) {
            totalMissing += missingMsgids.length;
            languagesWithMissing.push({ lang, count: missingMsgids.length, msgids: missingMsgids });
        }
    }

    if (totalMissing === 0) {
        console.log('✓ All translations are present!\n');
        process.exit(0);
    }

    console.error(`✗ Found ${totalMissing} missing translations in ${languagesWithMissing.length} languages:\n`);

    for (const { lang, count, msgids } of languagesWithMissing) {
        console.error(`  ${lang}: ${count} missing`);
        if (count <= 5) {
            msgids.forEach(msgid => console.error(`    - "${msgid}"`));
        }
    }

    console.error('\nTo fix this issue:');
    console.error('  1. Run: cd packages/dashboard && npm run i18n:extract');
    console.error('  2. Copy missing-translations.txt content to an LLM for translation');
    console.error('  3. Save output to translations.txt');
    console.error('  4. Run: npm run i18n:apply translations.txt\n');

    process.exit(1);
}

checkTranslations();
