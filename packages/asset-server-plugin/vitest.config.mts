import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mts';

export default defineConfig({
    test: {
        ...sharedTestConfig,
    },
});
