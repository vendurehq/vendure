import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Type-level tests (`*.spec-d.ts`) are run via `vitest --typecheck`.
        // `tsconfig.spec-d.json` deliberately scopes the type-check program to the
        // `*.spec-d.ts` files (and their transitive imports) only — it does NOT type-check
        // the runtime specs. This is intentional: the runtime `plugin.spec.ts` has a
        // pre-existing type issue (accessing the private `EmailPlugin.options`) that is
        // unrelated to type tests and out of scope here. Project-wide `tsc` is unaffected.
        typecheck: {
            tsconfig: path.join(__dirname, 'tsconfig.spec-d.json'),
        },
    },
    plugins: [
        // SWC required to support decorators used in test plugins
        // See https://github.com/vitest-dev/vitest/issues/708#issuecomment-1118628479
        // Vite plugin
        swc.vite(),
    ],
});
