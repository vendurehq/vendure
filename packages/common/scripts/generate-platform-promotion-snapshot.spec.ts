import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { platformPromotionSnapshot } from '../src/platform-promotion-snapshot';

import { generatePlatformPromotionSnapshot } from './generate-platform-promotion-snapshot';

describe('generatePlatformPromotionSnapshot()', () => {
    const existingSnapshot = '// existing snapshot\n';
    let dir: string;
    let outputFile: string;

    function writeCatalog(body: unknown) {
        const file = path.join(dir, 'catalog.json');
        fs.writeFileSync(file, JSON.stringify(body));
        return file;
    }

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-promotion-'));
        outputFile = path.join(dir, 'platform-promotion-snapshot.ts');
        fs.writeFileSync(outputFile, existingSnapshot);
        vi.stubEnv('VENDURE_DASHBOARD_SKIP_PLATFORM_CATALOG_FETCH', '');
        // No test may reach a real host.
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.reject(new Error('Unexpected fetch'))),
        );
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('writes a valid dashboardPromotion', async () => {
        const source = writeCatalog({ offers: [], dashboardPromotion: platformPromotionSnapshot });

        await expect(generatePlatformPromotionSnapshot(source, outputFile)).resolves.toBe(true);
        const written = fs.readFileSync(outputFile, 'utf-8');
        expect(written).toContain('export const platformPromotionSnapshot: DashboardPromotionV1 = {');
        expect(written).toContain(platformPromotionSnapshot.capabilities[0].key);
    });

    it('keeps the snapshot and warns for an invalid dashboardPromotion', async () => {
        const [first, ...rest] = platformPromotionSnapshot.capabilities;
        const source = writeCatalog({
            dashboardPromotion: {
                ...platformPromotionSnapshot,
                capabilities: [{ ...first, benefits: ['only one'] }, ...rest],
            },
        });

        await expect(generatePlatformPromotionSnapshot(source, outputFile)).resolves.toBe(false);
        expect(fs.readFileSync(outputFile, 'utf-8')).toBe(existingSnapshot);
        expect(console.warn).toHaveBeenCalledOnce();
    });

    it('keeps the snapshot and warns when the source cannot be read', async () => {
        await expect(
            generatePlatformPromotionSnapshot(path.join(dir, 'missing.json'), outputFile),
        ).resolves.toBe(false);
        expect(fs.readFileSync(outputFile, 'utf-8')).toBe(existingSnapshot);
        expect(console.warn).toHaveBeenCalledOnce();
    });

    it('keeps the snapshot and sends no request when the skip variable is set', async () => {
        vi.stubEnv('VENDURE_DASHBOARD_SKIP_PLATFORM_CATALOG_FETCH', 'true');

        await expect(
            generatePlatformPromotionSnapshot('https://catalog.invalid/v1/catalog', outputFile),
        ).resolves.toBe(false);
        expect(fetch).not.toHaveBeenCalled();
        expect(fs.readFileSync(outputFile, 'utf-8')).toBe(existingSnapshot);
    });
});
