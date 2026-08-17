import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import path from 'path';
import { pathToFileURL } from 'url';
import { defineConfig } from 'vite';

export default defineConfig({
    base: '/dashboard/',
    build: {
        outDir: './dist/dashboard',
    },
    plugins: [
        vendureDashboardPlugin({
            vendureConfigPath: pathToFileURL('./dev-config.ts'),
            api: {
                host: 'http://localhost',
                port: Number(process.env.API_PORT) || 3000,
            },
            gqlOutputPath: path.resolve(__dirname, './graphql/'),
        }),
    ],
});
