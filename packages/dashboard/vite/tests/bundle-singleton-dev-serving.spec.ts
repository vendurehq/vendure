import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SINGLETON_CANDIDATES } from './utils/bundle-singleton-audit.js';

const execFileAsync = promisify(execFile);
const packageRoot = join(__dirname, '..', '..');
const fixtureConfig = join(packageRoot, 'e2e', 'fixtures', 'e2e-vendure-config.ts');
const PORT = 5188;

/**
 * Runtime counterpart to `bundle-singleton.spec.ts`. That spec proves the
 * shipped artifact contains no duplicated code; this one proves the actual Vite
 * DEV server — where issue #4919 manifests — serves each singleton library as a
 * single shared optimized dependency (`/node_modules/.vite/deps/…`, the same
 * lane as `react`) rather than freezing it inside a pre-built chunk.
 *
 * When a library is frozen, a consumer's extension causes Vite to optimize its
 * own separate copy, and the dashboard's provider and the extension's hook bind
 * to different module instances. Serving from the shared dep lane is what makes
 * them one instance.
 *
 * Opt-in (`RUN_BUNDLE_AUDIT=true`, set by `npm run audit:bundle`): it boots a
 * real Vite dev server with cold dep-optimization, which is too slow and load-
 * sensitive to run in the standard unit suite. The artifact-level guard in
 * `bundle-singleton.spec.ts` runs on every push instead.
 */
describe.skipIf(process.env.RUN_BUNDLE_AUDIT !== 'true')('bundle singleton dev serving', () => {
    let libJs: string;
    let stopServer: () => void = () => undefined;

    beforeAll(async () => {
        await execFileAsync('npm', ['run', 'build:lib'], { cwd: packageRoot });
        const server = await startDevServer();
        stopServer = server.stop;
        libJs = await fetchWhenReady(`http://localhost:${server.port}/dist/bundle/lib.js`);
    }, 180_000);

    afterAll(() => stopServer());

    for (const candidate of SINGLETON_CANDIDATES) {
        const depFile = `${candidate.pkg.replace(/\//g, '_')}.js`;

        it(`serves ${candidate.pkg} as a shared optimized dep`, () => {
            // The extension-facing entry (lib.js) must reach the library through
            // the shared dep lane (/node_modules/.vite/deps) — the same lane as
            // react. If it were frozen into the bundle instead, lib.js would
            // import it from a /dist/bundle/chunks/ module and this dep would be
            // absent, reintroducing #4919.
            expect(
                libJs,
                `${candidate.pkg} is not served from /node_modules/.vite/deps — it is likely frozen into the bundle again`,
            ).toContain(`/node_modules/.vite/deps/${depFile}`);
        });
    }
});

async function startDevServer(): Promise<{ port: number; stop: () => void }> {
    const child = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
        cwd: packageRoot,
        detached: true,
        env: {
            ...process.env,
            VITE_USE_EXPERIMENTAL_BUNDLE: 'true',
            VENDURE_CONFIG_PATH: fixtureConfig,
            VITE_ADMIN_API_PORT: '3000',
        },
    });

    const stop = () => {
        try {
            process.kill(-child.pid!, 'SIGTERM');
        } catch {
            // already gone
        }
    };

    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Vite dev server did not start in time')), 60_000);
        const onData = (buf: Buffer) => {
            if (buf.toString().includes(`localhost:${PORT}`)) {
                clearTimeout(timer);
                child.stdout?.off('data', onData);
                resolve();
            }
        };
        child.stdout?.on('data', onData);
        child.on('exit', code => {
            clearTimeout(timer);
            reject(new Error(`Vite dev server exited early (code ${code})`));
        });
    });

    return { port: PORT, stop };
}

/**
 * Fetches `url`, retrying until the dep optimizer has run (the response
 * references the optimized-dep directory) or a timeout elapses.
 */
async function fetchWhenReady(url: string): Promise<string> {
    const deadline = Date.now() + 60_000;
    let body = '';
    while (Date.now() < deadline) {
        const res = await fetch(url).catch(() => undefined);
        if (res?.ok) {
            body = await res.text();
            if (body.includes('/node_modules/.vite/deps/')) {
                return body;
            }
        }
        await delay(500);
    }
    return body;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, ms);
    });
}
