import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mjs';

export default defineConfig({
    test: {
        ...sharedTestConfig,
    },
    plugins: [
        // SWC required to support decorators used in the plugin
        // See https://github.com/vitest-dev/vitest/issues/708#issuecomment-1118628479
        swc.vite(),
    ],
});
