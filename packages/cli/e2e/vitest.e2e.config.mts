import path from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        // SWC required to support decorators used in test plugins
        swc.vite({
            jsc: {
                transform: {
                    useDefineForClassFields: false,
                },
            },
        }) as any,
    ],
    test: {
        include: ['e2e/**/*.e2e-spec.ts'],
        globals: true,
        environment: 'node',
        testTimeout: 60000,
        pool: 'forks',
        // Run every e2e file in a single worker that shares one module graph.
        maxWorkers: 1,
        isolate: false,
        typecheck: {
            tsconfig: path.join(import.meta.dirname, 'config/tsconfig.e2e.json'),
        },
    },
});