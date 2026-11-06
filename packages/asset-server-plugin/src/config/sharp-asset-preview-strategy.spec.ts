import { RequestContext } from '@vendure/core';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { SharpAssetPreviewStrategy } from './sharp-asset-preview-strategy';

describe('SharpAssetPreviewStrategy', () => {
    const ctx = RequestContext.empty();

    async function createJpeg(width: number, height: number) {
        return sharp({ create: { width, height, channels: 3, background: '#888888' } })
            .jpeg()
            .toBuffer();
    }

    async function previewSize(strategy: SharpAssetPreviewStrategy, input: Buffer) {
        const preview = await strategy.generatePreviewImage(ctx, 'image/jpeg', input);
        const { width, height } = await sharp(preview).metadata();
        return { width, height };
    }

    it('caps previews at 1600 px by default', async () => {
        const size = await previewSize(new SharpAssetPreviewStrategy(), await createJpeg(4000, 3000));

        expect(size).toEqual({ width: 1600, height: 1200 });
    });

    it('caps previews at 1600 px when the dimension options are explicitly undefined', async () => {
        const strategy = new SharpAssetPreviewStrategy({ maxWidth: undefined, maxHeight: undefined });

        expect(await previewSize(strategy, await createJpeg(4000, 3000))).toEqual({
            width: 1600,
            height: 1200,
        });
        expect(await previewSize(strategy, await createJpeg(3000, 4000))).toEqual({
            width: 1200,
            height: 1600,
        });
    });

    it('keeps the default for a dimension that is undefined when the other one is set', async () => {
        const strategy = new SharpAssetPreviewStrategy({ maxWidth: 800, maxHeight: undefined });

        expect(await previewSize(strategy, await createJpeg(4000, 3000))).toEqual({
            width: 800,
            height: 600,
        });
        expect(await previewSize(strategy, await createJpeg(1000, 4000))).toEqual({
            width: 400,
            height: 1600,
        });
    });

    it('uses the configured dimensions', async () => {
        const strategy = new SharpAssetPreviewStrategy({ maxWidth: 500, maxHeight: 500 });

        expect(await previewSize(strategy, await createJpeg(4000, 3000))).toEqual({
            width: 500,
            height: 375,
        });
    });

    it('does not enlarge images smaller than the limit', async () => {
        const strategy = new SharpAssetPreviewStrategy({ maxWidth: undefined, maxHeight: undefined });

        expect(await previewSize(strategy, await createJpeg(400, 300))).toEqual({
            width: 400,
            height: 300,
        });
    });
});
