import type { StorybookConfig } from '@storybook/react-vite';

import { dirname, resolve } from 'path';

import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import { fileURLToPath, pathToFileURL } from 'url';
import { extractJSDocPlugin } from './extract-jsdoc-plugin.js';
import { transformJSDocPlugin } from './transform-jsdoc-plugin.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
    stories: ['./stories/Intro.mdx', './stories/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
    staticDirs: ['./assets'],
    addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
    framework: {
        name: '@storybook/react-vite',
        options: {},
    },
    core: {
        builder: '@storybook/builder-vite',
    },
    typescript: {
        reactDocgen: 'react-docgen-typescript',
        reactDocgenTypescriptOptions: {
            shouldExtractLiteralValuesFromEnum: true,
            shouldRemoveUndefinedFromOptional: true,
            propFilter: prop => {
                // Filter out props from node_modules
                if (prop.parent) {
                    return !prop.parent.fileName.includes('node_modules');
                }
                return true;
            },
            savePropValueAsString: true,
        },
    },
    async viteFinal(config) {
        const vendureConfigPath = pathToFileURL(resolve(__dirname, '../sample-vendure-config.ts'));

        return {
            ...config,
            plugins: [
                // Extract JSDoc descriptions from component files and inline into story metadata
                // Must run before other plugins to process withDescription() calls
                extractJSDocPlugin(),
                // Transform JSDoc in component files to remove custom tags (@description, @docsCategory, etc.)
                // for cleaner display in Storybook's auto-generated prop tables
                transformJSDocPlugin(),
                ...(config.plugins ?? []),
                vendureDashboardPlugin({
                    vendureConfigPath,
                    api: {
                        host: 'https://demo.vendure.io',
                        port: 443,
                    },
                    gqlOutputPath: resolve(__dirname, '../src/lib/graphql/'),
                    tempCompilationDir: resolve(__dirname, '../.temp'),
                    disablePlugins: { tanstackRouter: true, react: true },
                }),
            ],
        };
    },
};
export default config;
