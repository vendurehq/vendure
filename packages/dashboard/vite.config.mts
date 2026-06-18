import path from 'path';
import { pathToFileURL } from 'url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import { vendureDashboardPlugin } from './vite/vite-plugin-vendure-dashboard.js';

/**
 * This config is used for local development
 */
export default ({ mode }: { mode: string }) => {
    process.env = { ...process.env, ...loadEnv(mode, process.cwd()) };

    const adminApiHost = process.env.VITE_ADMIN_API_HOST ?? 'http://localhost';
    const adminApiPort = process.env.VITE_ADMIN_API_PORT ? +process.env.VITE_ADMIN_API_PORT : 'auto';

    process.env.IS_LOCAL_DEV = adminApiHost.includes('localhost') ? 'true' : 'false';

    const vendureConfigPath = process.env.VENDURE_CONFIG_PATH
        ?? (process.env.VITEST
            ? // This should always be used for running the tests
              './sample-vendure-config.ts'
            : // This one might be changed to '../dev-server/dev-config.ts' to test ui extensions
              './sample-vendure-config.ts');

    return defineConfig({
        optimizeDeps: {
            include: ['lodash/get', 'lodash/isString', 'lodash/isNaN'],
        },
        test: {
            globals: true,
            environment: 'jsdom',
            exclude: ['./e2e/**/*', './plugin/**/*', '**/node_modules/**/*'],
            environmentMatchGlobs: [
                ['vite/tests/**', 'node'],
            ],
        },
        plugins: [
            vendureDashboardPlugin({
                vendureConfigPath: pathToFileURL(vendureConfigPath),
                api: { host: adminApiHost, port: adminApiPort },
                tempCompilationDir: path.resolve(__dirname, './.temp'),
            }) as any,
        ],
    });
};
