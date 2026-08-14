import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mjs';

export default defineConfig({
    test: {
        ...sharedTestConfig,
        // better-sqlite3 Statement finalizers crash vitest thread-worker teardown on
        // Node 24 (`Assertion failed: (env) != nullptr` → ERR_IPC_CHANNEL_CLOSED),
        // which fails CI on unit tests (24.x). Forks exit the process cleanly.
        pool: 'forks',
    },
    plugins: [
        // SWC required to support decorators used in test plugins
        // See https://github.com/vitest-dev/vitest/issues/708#issuecomment-1118628479
        // Vite plugin
        swc.vite({
            jsc: {
                transform: {
                    // See https://github.com/vendurehq/vendure/issues/2099
                    useDefineForClassFields: false,
                },
            },
        }),
    ],
});
