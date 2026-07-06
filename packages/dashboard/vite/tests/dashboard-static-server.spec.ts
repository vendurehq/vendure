import express from 'express';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDashboardStaticServer } from '../../plugin/static-server.js';

/**
 * Regression coverage for #4841 — hard-loading `/dashboard/assets` returned a 404
 * because the `/assets` stale-chunk guard is a prefix match that also caught the
 * Assets SPA route. These tests mount the real static server under `/dashboard`
 * (mirroring how DashboardPlugin serves it in production) and assert that SPA
 * routes hard-load the index.html shell while genuine build artifacts still serve
 * (and missing ones still 404, so the module loader never receives HTML-as-JS).
 */
describe('Dashboard static server', () => {
    let server: http.Server;
    let baseUrl: string;
    let buildDir: string;
    const realChunk = 'index-abc123.js';
    const realStyles = 'styles-abc123.css';

    beforeAll(async () => {
        buildDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdb-static-'));
        fs.mkdirSync(path.join(buildDir, 'assets'), { recursive: true });
        fs.writeFileSync(
            path.join(buildDir, 'index.html'),
            '<!doctype html><html><head></head><body><div id="app">DASHBOARD_SHELL</div></body></html>',
        );
        fs.writeFileSync(path.join(buildDir, 'assets', realChunk), 'console.log("real chunk");');
        fs.writeFileSync(path.join(buildDir, 'assets', realStyles), 'body{color:red}');

        const app = express();
        // Mounted under /dashboard to mirror how DashboardPlugin serves it in production.
        app.use('/dashboard', createDashboardStaticServer(buildDir, 100_000));

        await new Promise<void>(resolve => {
            server = app.listen(0, () => resolve());
        });
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        baseUrl = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        fs.rmSync(buildDir, { recursive: true, force: true });
    });

    async function get(p: string) {
        // redirect: 'manual' so a 301 surfaces as a failing status rather than being followed.
        const res = await fetch(baseUrl + p, { redirect: 'manual' });
        const body = await res.text();
        const headers = Object.fromEntries(res.headers.entries());
        return { status: res.status, contentType: res.headers.get('content-type') ?? '', headers, body };
    }

    describe('Assets SPA route hard-loads the index.html shell', () => {
        it('GET /dashboard/assets', async () => {
            const res = await get('/dashboard/assets');
            expect(res.status).toBe(200);
            expect(res.contentType).toContain('text/html');
            expect(res.body).toContain('DASHBOARD_SHELL');
        });

        it('GET /dashboard/assets/ (trailing slash)', async () => {
            const res = await get('/dashboard/assets/');
            expect(res.status).toBe(200);
            expect(res.contentType).toContain('text/html');
            expect(res.body).toContain('DASHBOARD_SHELL');
        });

        it('GET /dashboard/assets with a query string', async () => {
            const res = await get('/dashboard/assets?perPage=24&viewMode=grid');
            expect(res.status).toBe(200);
            expect(res.contentType).toContain('text/html');
        });

        it('GET /dashboard/assets/:id (asset detail route)', async () => {
            const res = await get('/dashboard/assets/123');
            expect(res.status).toBe(200);
            expect(res.contentType).toContain('text/html');
            expect(res.body).toContain('DASHBOARD_SHELL');
        });
    });

    describe('genuine build artifacts are served', () => {
        it('serves a real JS chunk with a long-lived immutable cache header', async () => {
            const res = await get(`/dashboard/assets/${realChunk}`);
            expect(res.status).toBe(200);
            expect(res.contentType).toContain('javascript');
            expect(res.body).toContain('real chunk');
            // The immutable/long-max-age cache header is load-bearing for CDN behaviour (#4665).
            const cacheControl = res.headers['cache-control'] ?? '';
            expect(cacheControl).toContain('immutable');
            expect(cacheControl).toContain('max-age=31536000');
        });

        it('serves a real CSS artifact', async () => {
            const res = await get(`/dashboard/assets/${realStyles}`);
            expect(res.status).toBe(200);
            expect(res.contentType).toContain('text/css');
        });
    });

    describe('stale-chunk crash guard is intact', () => {
        it('404s a missing JS chunk instead of serving the HTML shell', async () => {
            const res = await get('/dashboard/assets/index-staleHASH.js');
            expect(res.status).toBe(404);
            expect(res.contentType).not.toContain('text/html');
            expect(res.body).not.toContain('DASHBOARD_SHELL');
        });

        it('404s a missing CSS chunk instead of serving the HTML shell', async () => {
            const res = await get('/dashboard/assets/missing-xyz.css');
            expect(res.status).toBe(404);
            expect(res.body).not.toContain('DASHBOARD_SHELL');
        });

        // Documents the discriminator's assumption: a `/assets` path whose last segment
        // contains a dot is treated as a (missing) build artifact and 404s. This is safe
        // today because no Assets SPA route segment contains a dot (ids are numeric/UUID).
        // If that ever changes, this test should be revisited alongside the route.
        it('treats a dotted /assets path segment as an artifact (current behaviour)', async () => {
            const res = await get('/dashboard/assets/some.slug');
            expect(res.status).toBe(404);
            expect(res.body).not.toContain('DASHBOARD_SHELL');
        });
    });

    describe('control routes keep working', () => {
        it('serves index.html for a non-assets deep route', async () => {
            const res = await get('/dashboard/catalog/products/1');
            expect(res.status).toBe(200);
            expect(res.contentType).toContain('text/html');
            expect(res.body).toContain('DASHBOARD_SHELL');
        });

        it('serves index.html for the dashboard root', async () => {
            const res = await get('/dashboard/');
            expect(res.status).toBe(200);
            expect(res.contentType).toContain('text/html');
        });
    });
});
