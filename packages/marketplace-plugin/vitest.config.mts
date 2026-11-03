import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['**/*.e2e-spec.ts', '**/*.spec.ts'],
        testTimeout: process.env.E2E_DEBUG ? 1800 * 1000 : process.env.CI ? 60 * 1000 : 60 * 1000,
        allowOnly: true,
    },
    plugins: [
        swc.vite({
            jsc: {
                transform: {
                    useDefineForClassFields: false,
                },
            },
        }),
    ],
});
