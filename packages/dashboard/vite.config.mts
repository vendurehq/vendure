import path from 'path';
import { pathToFileURL } from 'url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { vendureDashboardPlugin } from './vite/vite-plugin-vendure-dashboard.js';

import { sharedTestConfig } from '../../vitest.shared.mjs';

/**
 * This config is used for local development
 */
export default ({ mode }: { mode: string }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

    const adminApiHost = process.env.VITE_ADMIN_API_HOST ?? 'http://localhost';
    const adminApiPort = process.env.VITE_ADMIN_API_PORT ? +process.env.VITE_ADMIN_API_PORT : 'auto';

    process.env.IS_LOCAL_DEV = adminApiHost.includes('localhost') ? 'true' : 'false';
    if (process.env.VITEST) {
        // Unit tests never fetch the Platform catalog from api.vendure.io.
        process.env.VENDURE_DASHBOARD_SKIP_PLATFORM_CATALOG_FETCH = 'true';
    }

    // Serve the dashboard from its source, with HMR, unless the pre-built bundle is asked for
    // (the e2e suite and the bundle audit test, after `npm run build:lib`).
    if (process.env.VITE_DASHBOARD_BUNDLE !== 'true') {
        process.env.VENDURE_DASHBOARD_FROM_SOURCE = 'true';
    }

    // The tests always use the sample config. To try UI extensions in local development, set
    // VENDURE_CONFIG_PATH, e.g. to '../dev-server/dev-config.ts'.
    const vendureConfigPath = process.env.VENDURE_CONFIG_PATH ?? './sample-vendure-config.ts';

    return defineConfig({
        optimizeDeps: {
            include: ['lodash/get', 'lodash/isString', 'lodash/isNaN'],
        },
        test: {
            ...sharedTestConfig,
            globals: true,
            // The Vite plugin tests run in Node, everything else in jsdom.
            projects: [
                {
                    extends: true,
                    test: {
                        name: 'vite-plugin',
                        environment: 'node',
                        globalSetup: ['vite/tests/bundle-audit.global-setup.ts'],
                        include: ['vite/tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
                    },
                },
                {
                    extends: true,
                    test: {
                        name: 'dashboard',
                        environment: 'jsdom',
                        exclude: [
                            './dist/**/*',
                            './e2e/**/*',
                            './plugin/**/*',
                            './vite/tests/**/*',
                            '**/node_modules/**/*',
                        ],
                    },
                },
            ],
        },
        plugins: [
            vendureDashboardPlugin({
                vendureConfigPath: pathToFileURL(vendureConfigPath),
                api: { host: adminApiHost, port: adminApiPort },
                tempCompilationDir: path.resolve(import.meta.dirname, './.temp'),
            }) as any,
        ],
    });
};
