import 'reflect-metadata';

import { platformPromotionSnapshot } from '@vendure/common/lib/platform-promotion-snapshot';
import type { Plugin } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    loadDashboardPromotion,
    PLATFORM_CATALOG_URL,
    PLATFORM_PROMOTION_ENV,
    platformPromotionPlugin,
    SKIP_PLATFORM_CATALOG_FETCH_ENV,
} from '../vite-plugin-platform-promotion.js';

const fetchedPromotion = { ...platformPromotionSnapshot, navSections: [] };

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
    const fetchMock = vi.fn(impl);
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function jsonResponse(body: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
    // vite.config.mts sets this variable for all unit tests.
    vi.stubEnv(SKIP_PLATFORM_CATALOG_FETCH_ENV, '');
    // No test may reach a real host.
    stubFetch(() => Promise.reject(new Error('Unexpected fetch')));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('loadDashboardPromotion', () => {
    it('returns dashboardPromotion from the catalog', async () => {
        const fetchMock = stubFetch(() => jsonResponse({ offers: [], dashboardPromotion: fetchedPromotion }));

        await expect(loadDashboardPromotion()).resolves.toEqual(fetchedPromotion);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock.mock.calls[0][0]).toBe(PLATFORM_CATALOG_URL);
    });

    it('returns the snapshot when the fetch takes longer than 2 seconds', async () => {
        stubFetch(
            (_url, init) =>
                new Promise((_resolve, reject) =>
                    init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
                ),
        );
        const log = vi.fn();
        const start = Date.now();

        await expect(loadDashboardPromotion(log)).resolves.toBe(platformPromotionSnapshot);
        expect(Date.now() - start).toBeLessThan(3000);
        expect(log).toHaveBeenCalledOnce();
    });

    it('returns the snapshot when the fetch fails', async () => {
        stubFetch(() => Promise.reject(new TypeError('fetch failed')));

        await expect(loadDashboardPromotion()).resolves.toBe(platformPromotionSnapshot);
    });

    it('returns the snapshot on an HTTP error', async () => {
        stubFetch(() => jsonResponse({}, 503));

        await expect(loadDashboardPromotion()).resolves.toBe(platformPromotionSnapshot);
    });

    it.each([
        ['no dashboardPromotion', { offers: [] }],
        ['an unknown version', { dashboardPromotion: { ...fetchedPromotion, version: 2 } }],
        ['a malformed payload', { dashboardPromotion: { ...fetchedPromotion, capabilities: {} } }],
        ['a null body', null],
    ])('returns the snapshot for %s', async (_name, body) => {
        stubFetch(() => jsonResponse(body));

        await expect(loadDashboardPromotion()).resolves.toBe(platformPromotionSnapshot);
    });

    it(`does not fetch when ${SKIP_PLATFORM_CATALOG_FETCH_ENV} is "true"`, async () => {
        vi.stubEnv(SKIP_PLATFORM_CATALOG_FETCH_ENV, 'true');
        const fetchMock = stubFetch(() => jsonResponse({ dashboardPromotion: fetchedPromotion }));

        await expect(loadDashboardPromotion()).resolves.toBe(platformPromotionSnapshot);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('platformPromotionPlugin', () => {
    async function loadVirtualModule(plugins: unknown[], options?: { enabled?: boolean }) {
        const plugin = platformPromotionPlugin(options);
        const configLoader = {
            name: 'vendure:config-loader',
            api: { getVendureConfig: () => Promise.resolve({ vendureConfig: { plugins } }) },
        };
        (plugin.configResolved as (config: unknown) => void)({ plugins: [configLoader] });
        const resolved = (plugin.resolveId as (id: string) => string)('virtual:vendure-platform-promotion');
        const code: string = await (plugin.load as Plugin['load'] & ((id: string) => any)).call(
            { warn: vi.fn() },
            resolved,
        );
        return code;
    }

    it('exports the promotion data and licenseGuardConfigured: false without License Guard', async () => {
        vi.stubEnv(SKIP_PLATFORM_CATALOG_FETCH_ENV, 'true');
        class DefaultSearchPlugin {}
        const code = await loadVirtualModule([DefaultSearchPlugin]);

        expect(code).toContain(
            `export const dashboardPromotion = ${JSON.stringify(platformPromotionSnapshot)};`,
        );
        expect(code).toContain('export const licenseGuardConfigured = false;');
        expect(code).toContain('export const platformPromotionEnabled = true;');
    });

    it('exports licenseGuardConfigured: true when the config contains LicenseGuardPlugin', async () => {
        vi.stubEnv(SKIP_PLATFORM_CATALOG_FETCH_ENV, 'true');
        class LicenseGuardPlugin {}
        const code = await loadVirtualModule([{ module: LicenseGuardPlugin }]);

        expect(code).toContain('export const licenseGuardConfigured = true;');
    });

    function expectNoPromotion(code: string) {
        expect(fetch).not.toHaveBeenCalled();
        expect(code).toContain('export const platformPromotionEnabled = false;');
        expect(code).toContain(
            'export const dashboardPromotion = {"version":1,"navSections":[],"navItems":[],"pageBlocks":[],"actions":[],"capabilities":[]};',
        );
    }

    it('turns off all promotion with the platformPromotion: false option alone', async () => {
        expectNoPromotion(await loadVirtualModule([], { enabled: false }));
    });

    it(`turns off all promotion with ${PLATFORM_PROMOTION_ENV}=false alone`, async () => {
        vi.stubEnv(PLATFORM_PROMOTION_ENV, 'false');
        expectNoPromotion(await loadVirtualModule([]));
    });
});
