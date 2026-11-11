import { existsSync } from 'node:fs';
import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mjs';

/**
 * The Vitest config of the `test` target of Vendure plugin packages.
 * The target runs Vitest with the package folder as the working directory.
 */
const typeTestConfig = path.join(process.cwd(), 'tsconfig.spec-d.json');

export default defineConfig({
    test: {
        ...sharedTestConfig,
        // Type-level tests (`*.spec-d.ts`) run with `vitest --typecheck`.
        // The sync generator writes `tsconfig.spec-d.json` when a package has type-level tests.
        typecheck: existsSync(typeTestConfig) ? { tsconfig: typeTestConfig } : undefined,
    },
    plugins: [
        // SWC is required to support decorators.
        // See https://github.com/vitest-dev/vitest/issues/708#issuecomment-1118628479
        swc.vite(),
    ],
});
