import { vendureDashboardPlugin } from '@vendure/dashboard/vite';
import path from 'path';
import { pathToFileURL } from 'url';
import { defineConfig } from 'vite';

const adminApiHost = process.env.VITE_ADMIN_API_HOST || 'http://localhost';
const adminApiPort = process.env.VITE_ADMIN_API_PORT
    ? process.env.VITE_ADMIN_API_PORT === 'auto'
        ? 'auto'
        : Number(process.env.VITE_ADMIN_API_PORT)
    : process.env.VITE_ADMIN_API_HOST
      ? 'auto'
      : Number(process.env.API_PORT) || 3000;

export default defineConfig({
    base: '/dashboard/',
    server: {
        host: process.env.HOST || 'localhost',
        port: Number(process.env.PORT) || 5173,
        strictPort: true,
    },
    build: {
        outDir: './dist/dashboard',
    },
    plugins: [
        vendureDashboardPlugin({
            vendureConfigPath: pathToFileURL('./dev-config.ts'),
            api: {
                host: adminApiHost,
                port: adminApiPort,
            },
            gqlOutputPath: path.resolve(__dirname, './graphql/'),
        }),
    ],
});
