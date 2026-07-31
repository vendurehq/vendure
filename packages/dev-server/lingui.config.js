import { defineConfig } from '@lingui/cli';
import { formatter } from '@lingui/format-po';

export default defineConfig({
    sourceLocale: 'en',
    locales: ['en', 'de'],
    // Line numbers in the `#:` reference comments churn on every unrelated edit
    // to a source file, which makes the catalogs a constant source of merge conflicts.
    format: formatter({ lineNumbers: false }),
    catalogs: [
        {
            path: '<rootDir>/test-plugins/reviews/dashboard/i18n/{locale}',
            include: ['<rootDir>/test-plugins/reviews/dashboard/**'],
        },
    ],
});
