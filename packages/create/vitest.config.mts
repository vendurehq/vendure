import { defineConfig } from 'vitest/config';

// @vendure/create is plain TypeScript with no decorators or DI, so vitest's
// default esbuild transform handles it without any plugins. The explicit
// `include` pattern keeps the spec discovery scoped to src/.
export default defineConfig({
    test: {
        include: ['src/**/*.spec.ts'],
    },
});
