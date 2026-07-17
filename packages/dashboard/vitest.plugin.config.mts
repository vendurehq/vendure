import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mjs';

export default defineConfig({
    test: {
        ...sharedTestConfig,
        environment: 'node',
        include: ['plugin/**/*.spec.ts'],
    },
    plugins: [swc.vite()],
});
