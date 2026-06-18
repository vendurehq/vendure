const path = require('node:path');
const fs = require('fs-extra');
const spawn = require('cross-spawn');
const { exec } = require('node:child_process');

const MESSAGES_DIR = path.join(__dirname, '../src/lib/static/i18n-messages');

extractTranslations().then(
    () => {
        process.exit(0);
    },
    error => {
        console.log(error);
        process.exit(1);
    },
);

/**
 * Extracts translation tokens into the i18n-messages files found in the MESSAGES_DIR.
 */
async function extractTranslations() {
    const locales = fs.readdirSync(MESSAGES_DIR).map(file => path.basename(file).replace('.json', ''));
    const report = {
        generatedOn: new Date().toISOString(),
        lastCommit: await getLastGitCommitHash(),
        translationStatus: {},
    };
    console.log(`locales`, locales);
    for (const locale of locales) {
        const outputPath = path.join(
            path.relative(path.join(__dirname, '..'), MESSAGES_DIR),
            `${locale}.json`,
        );
        console.log(`Extracting translation tokens for "${outputPath}"`);

        try {
            await runExtraction(locale);
            const { tokenCount, translatedCount, percentage } = getStatsForLocale(locale);
            console.log(`${locale}: ${translatedCount} of ${tokenCount} tokens translated (${percentage}%)`);
            console.log('');
            report.translationStatus[locale] = { tokenCount, translatedCount, percentage };
        } catch (e) {
            console.log(e);
        }
    }

    const reportFile = path.join(__dirname, '../i18n-coverage.json');
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf-8');
    console.log(`Report saved to "${reportFile}"`);
}

function runExtraction(locale) {
    const command = 'npx';
    const args = getNgxTranslateExtractCommand(locale);
    return new Promise((resolve, reject) => {
        try {
            const child = spawn(command, args, { stdio: ['inherit', 'inherit', 'inherit'] });
            child.on('close', x => {
                resolve();
            });
            child.on('error', err => {
                reject(err);
            });
        } catch (e) {
            reject(e);
        }
    });
}

function getStatsForLocale(locale) {
    const content = fs.readJsonSync(path.join(MESSAGES_DIR, `${locale}.json`), 'utf-8');
    let tokenCount = 0;
    let translatedCount = 0;
    for (const section of Object.keys(content)) {
        const sectionTranslations = Object.values(content[section]);
        tokenCount += sectionTranslations.length;
        translatedCount += sectionTranslations.filter(val => val !== '').length;
    }
    const percentage = Math.round((translatedCount / tokenCount) * 100);
    return {
        tokenCount,
        translatedCount,
        percentage,
    };
}

function getNgxTranslateExtractCommand(locale) {
    return [
        `ngx-translate-extract`,
        '--input',
        './src',
        '--output',
        `./src/lib/static/i18n-messages/${locale}.json`,
        `--clean`,
        `--sort`,
        `--format`,
        `namespaced-json`,
        `--format-indentation`,
        `  `,
        `-m`,
        `_`,
    ];
}

function getLastGitCommitHash() {
    return new Promise((resolve, reject) => {
        exec('git rev-parse HEAD', (err, result) => {
            if (err) {
                reject(err);
            } else {
                resolve(result.replace('\n', ''));
            }
        });
    });
}
