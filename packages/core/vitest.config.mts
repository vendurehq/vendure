import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

import { sharedTestConfig } from '../../vitest.shared.mjs';

export default defineConfig({
    test: {
        ...sharedTestConfig,
        // Type-level tests (`*.spec-d.ts`) are run via `vitest --typecheck`.
        // `tsconfig.spec-d.json` scopes the type-check program to the `*.spec-d.ts` files
        // and their imports, so the runtime specs are not type-checked.
        typecheck: {
            // `import.meta.dirname` is not in the Node 18 types of this package.
            tsconfig: fileURLToPath(new URL('./tsconfig.spec-d.json', import.meta.url)),
        },
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
