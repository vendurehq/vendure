import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
    plugins: [react()],
    // Relative, so the plugin can serve the app under any route. See `createStaticServer`.
    base: './',
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
