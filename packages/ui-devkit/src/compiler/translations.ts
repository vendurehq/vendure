import { LanguageCode } from '@vendure/common/lib/generated-types';
import * as fs from 'fs-extra';
import { globSync } from 'glob';
import * as path from 'path';

import { Extension, TranslationExtension, Translations } from './types';
import { logger } from './utils';

/**
 * Given an array of extensions, returns a map of languageCode to all files specified by the
 * configured globs.
 */
export function getAllTranslationFiles(extensions: TranslationExtension[]): {
    [languageCode in LanguageCode]?: string[];
} {
    // First collect all globs by language
    const allTranslationsWithGlobs: { [languageCode in LanguageCode]?: string[] } = {};
    for (const extension of extensions) {
        for (const [languageCode, globPattern] of Object.entries(extension.translations || {})) {
            const code = languageCode as LanguageCode;
            if (globPattern) {
                if (!allTranslationsWithGlobs[code]) {
                    allTranslationsWithGlobs[code] = [globPattern];
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    allTranslationsWithGlobs[code]!.push(globPattern);
                }
            }
        }
    }

    const allTranslationsWithFiles: { [languageCode in LanguageCode]?: string[] } = {};

    for (const [languageCode, globs] of Object.entries(allTranslationsWithGlobs)) {
        const code = languageCode as LanguageCode;
        allTranslationsWithFiles[code] = [];
        if (!globs) {
            continue;
        }
        for (const pattern of globs) {
            const files = globSync(pattern);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            allTranslationsWithFiles[code]!.push(...files);
        }
    }
    return allTranslationsWithFiles;
}

export async function mergeExtensionTranslations(
    outputPath: string,
    translationFiles: { [languageCode in LanguageCode]?: string[] },
) {
    // Now merge them into the final language-speicific json files
    const i18nMessagesDir = path.join(outputPath, 'src/i18n-messages');
    for (const [languageCode, files] of Object.entries(translationFiles)) {
        if (!files) {
            continue;
        }
        const translationFile = path.join(i18nMessagesDir, `${languageCode}.json`);
        const translationBackupFile = path.join(i18nMessagesDir, `${languageCode}.json.bak`);

        if (fs.existsSync(translationBackupFile)) {
            // restore the original translations from the backup
            await fs.copy(translationBackupFile, translationFile);
        }
        let translations: any = {};
        if (fs.existsSync(translationFile)) {
            // create a backup of the original (unextended) translations
            await fs.copy(translationFile, translationBackupFile);
            try {
                translations = await fs.readJson(translationFile);
            } catch (e: any) {
                logger.error(`Could not load translation file: ${translationFile}`);
                logger.error(e);
            }
        }

        for (const file of files) {
            try {
                const contents = await fs.readJson(file);
                translations = mergeTranslations(translations, contents);
            } catch (e: any) {
                logger.error(`Could not load translation file: ${translationFile}`);
                logger.error(e);
            }
        }

        // write the final translation files to disk
        const sortedTranslations = sortTranslationKeys(translations);
        await fs.writeFile(translationFile, JSON.stringify(sortedTranslations, null, 2), 'utf8');
    }
}

/**
 * Sorts the contents of the translation files so the sections & keys are alphabetical.
 */
function sortTranslationKeys(translations: Translations): Translations {
    const result: Translations = {};
    const sections = Object.keys(translations).sort();
    for (const section of sections) {
        const sortedTokens = Object.entries(translations[section])
            .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : 1))
            .reduce((output, [key, val]) => ({ ...output, [key]: val }), {});
        result[section] = sortedTokens;
    }
    return result;
}

/**
 * Merges the second set of translations into the first, returning a new translations
 * object.
 */
function mergeTranslations(t1: Translations, t2: Translations): Translations {
    const result = { ...t1 };
    for (const [section, translations] of Object.entries(t2)) {
        result[section] = {
            ...t1[section],
            ...translations,
        };
    }
    return result;
}
