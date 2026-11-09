import { createRequire } from 'node:module';
import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
    resolve: {
        /**
         * graphql ships both a CommonJS and an ESM build. @vendure/core is CommonJS and loads
         * the CommonJS one, but Vite prefers the `module` field when it resolves a dependency
         * for a transformed test file, so a package such as graphql-query-complexity can pull
         * in the ESM build. graphql-js compares constructor identity, so the two builds make it
         * reject types built by the other with "Cannot use GraphQLNonNull from another module
         * or realm". Pinning the specifier to the entry Node would pick keeps it to one copy.
         */
        alias: [{ find: /^graphql$/, replacement: require.resolve('graphql') }],
    },
    test: {
        include: ['**/*.e2e-spec.ts'],
        /**
         * For local debugging of the e2e tests, we set a very long timeout value otherwise tests will
         * automatically fail for going over the 5 second default timeout.
         */
        testTimeout: process.env.E2E_DEBUG ? 1800 * 1000 : process.env.CI ? 30 * 1000 : 15 * 1000,
        // threads: false,
        // singleThread: true,
        // reporters: ['verbose'],
        typecheck: {
            tsconfig: path.join(__dirname, 'tsconfig.e2e.json'),
        },
        // In jobs-queue.e2e-spec.ts, we use `it.only()` for sqljs, so we need this
        // set to true to avoid failures in CI.
        allowOnly: true,
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
