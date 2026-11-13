// Minimal vitest config for the OSS-1007 TZ spike (avoids vendureDashboardPlugin, which needs a built @vendure/core). NOT for merge.
import path from 'node:path';
import { defineConfig } from 'vitest/config';
const dash = path.resolve(import.meta.dirname, '../../..');
export default defineConfig({
    root: dash,
    resolve: {
        alias: [
            { find: '@/vdb', replacement: path.join(dash, 'src/lib') },
            { find: /^virtual:.*$/, replacement: path.join(dash, 'src/lib/__tz-spike__/virtual-stub.ts') },
        ],
    },
    test: { environment: 'jsdom', globals: true, include: ['src/**/__tz-spike__/*.spec.ts'] },
});
