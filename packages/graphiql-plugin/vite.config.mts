import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    base: '/graphiql/',
    build: {
        outDir: 'dist/graphiql',
        emptyOutDir: true,
        sourcemap: true,
        minify: true,
        rollupOptions: {
            output: {
                manualChunks: undefined,
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src/ui'),
        },
    },
    server: {
        port: 4000,
        open: true,
    },
});
