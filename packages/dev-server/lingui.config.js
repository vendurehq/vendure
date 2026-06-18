import { defineConfig } from '@lingui/cli';

export default defineConfig({
    sourceLocale: 'en',
    locales: ['en', 'de'],
    catalogs: [
        {
            path: '<rootDir>/test-plugins/reviews/dashboard/i18n/{locale}',
            include: ['<rootDir>/test-plugins/reviews/dashboard/**'],
        },
    ],
});
