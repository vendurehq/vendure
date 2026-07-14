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
    ],
    webServer: {
        command: `npx vite build && npx vite preview --port ${VITE_PORT}`,
        port: VITE_PORT,
        cwd: path.join(__dirname, '..'),
        reuseExistingServer: !process.env.CI,
        env: {
            VITE_ADMIN_API_PORT: String(VENDURE_PORT),
            VITE_ADMIN_API_HOST: 'http://localhost',
            VENDURE_CONFIG_PATH: path.join(__dirname, 'fixtures/e2e-vendure-config.ts'),
        },
        timeout: 120_000,
    },
});
