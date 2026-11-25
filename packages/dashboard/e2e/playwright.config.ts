import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VENDURE_PORT } from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VITE_PORT = Number(process.env.VITE_TEST_PORT) || 5174;

export default defineConfig({
    build: {
        // In this monorepo, workspace packages (e.g. @vendure/core) are symlinked
        // so their real paths fall outside node_modules. Without this, Playwright's
        // Babel transform re-processes compiled JS and breaks CJS module init order.
        external: ['**/packages/core/**', '**/packages/common/**', '**/packages/testing/**'],
    },
    testDir: './tests',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 4 : undefined,
    reporter: process.env.CI ? [['github'], ['list']] : 'html',
    globalSetup: './global-setup.ts',
    globalTeardown: './global-teardown.ts',
    use: {
        baseURL: `http://localhost:${VITE_PORT}`,
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
    projects: [
        {
            name: 'setup',
            testMatch: /auth\.setup\.ts/,
        },
        {
            name: 'chromium',
            use: {
                ...devices['Desktop Chrome'],
                storageState: path.join(__dirname, '.auth/admin.json'),
            },
            dependencies: ['setup'],
        },
        {
            // Layout shift specs (`e2e/layout-stability`): run with `bun run e2e:pw -- layout-stability`.
            name: 'layout-stability',
            testDir: './layout-stability',
            use: {
                ...devices['Desktop Chrome'],
                storageState: path.join(__dirname, '.auth/admin.json'),
                contextOptions: { reducedMotion: 'reduce' },
                actionTimeout: 15_000,
            },
            dependencies: ['setup'],
        },
    ],
    webServer: {
        // Tests the pre-built bundle, as projects that install the package get it. The app is
        // built outside `dist`, so that the build does not empty `dist/bundle` and the app is
        // never published with the package.
        command: `npm run build:lib && npx vite build --outDir e2e/.dist && npx vite preview --outDir e2e/.dist --port ${VITE_PORT}`,
        port: VITE_PORT,
        cwd: path.join(__dirname, '..'),
        reuseExistingServer: !process.env.CI,
        env: {
            VITE_ADMIN_API_PORT: String(VENDURE_PORT),
            VITE_ADMIN_API_HOST: 'http://localhost',
            VITE_DASHBOARD_BUNDLE: 'true',
            VENDURE_CONFIG_PATH: path.join(__dirname, 'fixtures/e2e-vendure-config.ts'),
            // Build with the bundled Platform catalog snapshot, not the live catalog.
            VENDURE_DASHBOARD_SKIP_PLATFORM_CATALOG_FETCH: 'true',
        },
        timeout: 120_000,
    },
});
