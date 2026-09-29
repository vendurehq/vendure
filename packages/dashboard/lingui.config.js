import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

export default defineConfig({
    sourceLocale: 'en',
    // Line numbers in the `#:` reference comments churn on every unrelated edit
    // to a source file, which makes the catalogs a constant source of merge conflicts.
    format: formatter({ lineNumbers: false }),
    locales: [
        'he',
        'ar',
        'de',
        'en',
        'es',
        'pl',
        'zh_Hans',
        'zh_Hant',
        'pt_BR',
        'pt_PT',
        'cs',
        'fr',
        'ru',
        'hu',
        'uk',
        'it',
        'fa',
        'ne',
        'hr',
        'nb',
        'sv',
        'tr',
        'ja',
        'ko',
        'bg',
        'nl',
        'ro',
        'uz'
    ],
    orderBy: 'messageId',
    catalogs: [
        {
            path: '<rootDir>/src/i18n/locales/{locale}',
            include: ['<rootDir>/src'],
            exclude: ['<rootDir>/src/**/*.stories.tsx'],
        },
    ],
});
