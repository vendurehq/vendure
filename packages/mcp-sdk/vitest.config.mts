import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        // SWC required to support the decorators used in the contract spec.
        // See https://github.com/vitest-dev/vitest/issues/708#issuecomment-1118628479
        swc.vite(),
    ],
});
