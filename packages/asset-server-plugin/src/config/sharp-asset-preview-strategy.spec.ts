import { RequestContext } from '@vendure/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createImageWithXmp, hasDigitalSourceType } from '../xmp-test-utils';

import { SharpAssetPreviewStrategy } from './sharp-asset-preview-strategy';

// #5568 - the preview must keep the XMP packet of the source, e.g. an AI provenance marking
describe('SharpAssetPreviewStrategy metadata', () => {
    const ctx = {} as RequestContext;
    const strategy = new SharpAssetPreviewStrategy();

    for (const format of ['jpeg', 'png', 'webp'] as const) {
        it(`keeps XMP in the preview of a large ${format} source`, async () => {
            const source = await createImageWithXmp(format, 2000, 1500);
            const preview = await strategy.generatePreviewImage(ctx, `image/${format}`, source);
            expect(await hasDigitalSourceType(preview)).toBe(true);
        });
    }

    it('keeps XMP in the preview of a source smaller than the maximum dimensions', async () => {
        const source = await createImageWithXmp('jpeg', 200, 100);
        const preview = await strategy.generatePreviewImage(ctx, 'image/jpeg', source);
        expect(await hasDigitalSourceType(preview)).toBe(true);
    });

    it('keeps only XMP, not EXIF', async () => {
        const source = await createImageWithXmp('jpeg', 2000, 1500);
        const preview = await strategy.generatePreviewImage(ctx, 'image/jpeg', source);
        expect(await hasDigitalSourceType(preview)).toBe(true);
        expect((await sharp(preview).metadata()).exif).toBeUndefined();
    });
});
