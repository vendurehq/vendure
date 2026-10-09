import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mjs';

export default defineConfig({
    test: {
        ...sharedTestConfig,
    },
});
