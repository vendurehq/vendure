import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { getValidBackgroundColor } from './common';
import { PresetOnlyStrategy } from './config/preset-only-strategy';
import { Dimensions, Point, resizeToFocalPoint, transformImage } from './transform-image';
import { createImageWithXmp, hasDigitalSourceType } from './xmp-test-utils';

describe('resizeToFocalPoint', () => {
    it('no resize, crop left', () => {
        const original: Dimensions = { w: 200, h: 100 };
        const target: Dimensions = { w: 100, h: 100 };
        const focalPoint: Point = { x: 50, y: 50 };
        const result = resizeToFocalPoint(original, target, focalPoint);

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.region).toEqual({
            left: 0,
            top: 0,
            width: 100,
            height: 100,
        });
    });

    it('no resize, crop top left', () => {
        const original: Dimensions = { w: 200, h: 100 };
        const target: Dimensions = { w: 100, h: 100 };
        const focalPoint: Point = { x: 0, y: 0 };
        const result = resizeToFocalPoint(original, target, focalPoint);

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.region).toEqual({
            left: 0,
            top: 0,
            width: 100,
            height: 100,
        });
    });

    it('no resize, crop center', () => {
        const original: Dimensions = { w: 200, h: 100 };
        const target: Dimensions = { w: 100, h: 100 };
        const focalPoint: Point = { x: 100, y: 50 };
        const result = resizeToFocalPoint(original, target, focalPoint);

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.region).toEqual({
            left: 50,
            top: 0,
            width: 100,
            height: 100,
        });
    });

    it('crop with resize', () => {
        const original: Dimensions = { w: 200, h: 100 };
        const target: Dimensions = { w: 25, h: 50 };
        const focalPoint: Point = { x: 50, y: 50 };
        const result = resizeToFocalPoint(original, target, focalPoint);

        expect(result.width).toBe(100);
        expect(result.height).toBe(50);
        expect(result.region).toEqual({
            left: 13,
            top: 0,
            width: 25,
            height: 50,
        });
    });
});

describe('getValidBackgroundColor', () => {
    it('accepts 6-char hex without #', () => {
        expect(getValidBackgroundColor('ffffff')).toBe('#ffffff');
    });

    it('accepts 6-char hex with #', () => {
        expect(getValidBackgroundColor('#F0A703')).toBe('#f0a703');
    });

    it('accepts 3-char shorthand hex', () => {
        expect(getValidBackgroundColor('fff')).toBe('#fff');
    });

    it('accepts 8-char hex with alpha', () => {
        expect(getValidBackgroundColor('ffffff80')).toBe('#ffffff80');
    });

    it('accepts 4-char shorthand hex with alpha', () => {
        expect(getValidBackgroundColor('fff8')).toBe('#fff8');
    });

    it('returns undefined for empty string', () => {
        expect(getValidBackgroundColor('')).toBeUndefined();
    });

    it('returns undefined for non-string input', () => {
        expect(getValidBackgroundColor(undefined)).toBeUndefined();
        expect(getValidBackgroundColor(123)).toBeUndefined();
        expect(getValidBackgroundColor(null)).toBeUndefined();
    });

    it('returns undefined for invalid hex characters', () => {
        expect(getValidBackgroundColor('gggggg')).toBeUndefined();
        expect(getValidBackgroundColor('xyz')).toBeUndefined();
    });

    it('returns undefined for wrong length hex', () => {
        expect(getValidBackgroundColor('ff')).toBeUndefined();
        expect(getValidBackgroundColor('fffff')).toBeUndefined();
        expect(getValidBackgroundColor('fffffffff')).toBeUndefined();
    });
});

describe('transformImage with backgroundColor', () => {
    function createTestPngWithAlpha(width: number, height: number): Promise<Buffer> {
        return sharp({
            create: {
                width,
                height,
                channels: 4,
                background: { r: 255, g: 0, b: 0, alpha: 0.5 },
            },
        })
            .png()
            .toBuffer();
    }

    it('flattens alpha channel with specified background color', async () => {
        const input = await createTestPngWithAlpha(10, 10);
        const result = await transformImage(input, {
            width: 10,
            height: 10,
            mode: 'resize',
            quality: undefined,
            format: 'png',
            fpx: undefined,
            fpy: undefined,
            preset: undefined,
            backgroundColor: '#ffffff',
        });
        const buffer = await result.toBuffer();
        const { channels, hasAlpha } = await sharp(buffer).metadata();
        expect(channels).toBe(3);
        expect(hasAlpha).toBe(false);
    });

    it('preserves alpha channel when no backgroundColor is set', async () => {
        const input = await createTestPngWithAlpha(10, 10);
        const result = await transformImage(input, {
            width: 10,
            height: 10,
            mode: 'resize',
            quality: undefined,
            format: 'png',
            fpx: undefined,
            fpy: undefined,
            preset: undefined,
            backgroundColor: undefined,
        });
        const buffer = await result.toBuffer();
        const { channels, hasAlpha } = await sharp(buffer).metadata();
        expect(channels).toBe(4);
        expect(hasAlpha).toBe(true);
    });
});

describe('PresetOnlyStrategy permittedBackgroundColors', () => {
    const presets = [{ name: 'thumb', width: 100, height: 100, mode: 'crop' as const }];
    const baseInput = {
        width: undefined,
        height: undefined,
        mode: undefined,
        quality: undefined,
        format: undefined,
        fpx: undefined,
        fpy: undefined,
        preset: 'thumb',
        backgroundColor: '#ffffff',
    };

    it('drops backgroundColor when permittedBackgroundColors is omitted', () => {
        const strategy = new PresetOnlyStrategy({ defaultPreset: 'thumb' });
        const result = strategy.getImageTransformParameters({
            input: baseInput,
            availablePresets: presets,
            req: {} as any,
        });
        expect(result.backgroundColor).toBeUndefined();
    });

    it('allows any backgroundColor when set to "any"', () => {
        const strategy = new PresetOnlyStrategy({
            defaultPreset: 'thumb',
            permittedBackgroundColors: 'any',
        });
        const result = strategy.getImageTransformParameters({
            input: baseInput,
            availablePresets: presets,
            req: {} as any,
        });
        expect(result.backgroundColor).toBe('#ffffff');
    });

    it('allows a whitelisted backgroundColor', () => {
        const strategy = new PresetOnlyStrategy({
            defaultPreset: 'thumb',
            permittedBackgroundColors: ['#ffffff', '#000000'],
        });
        const result = strategy.getImageTransformParameters({
            input: baseInput,
            availablePresets: presets,
            req: {} as any,
        });
        expect(result.backgroundColor).toBe('#ffffff');
    });

    it('drops a non-whitelisted backgroundColor', () => {
        const strategy = new PresetOnlyStrategy({
            defaultPreset: 'thumb',
            permittedBackgroundColors: ['#000000'],
        });
        const result = strategy.getImageTransformParameters({
            input: baseInput,
            availablePresets: presets,
            req: {} as any,
        });
        expect(result.backgroundColor).toBeUndefined();
    });

    it('whitelist comparison is case-insensitive', () => {
        const strategy = new PresetOnlyStrategy({
            defaultPreset: 'thumb',
            permittedBackgroundColors: ['#FFFFFF'],
        });
        const result = strategy.getImageTransformParameters({
            input: { ...baseInput, backgroundColor: '#ffffff' },
            availablePresets: presets,
            req: {} as any,
        });
        expect(result.backgroundColor).toBe('#ffffff');
    });

    it('whitelist comparison is case-insensitive with # prefix', () => {
        const strategy = new PresetOnlyStrategy({
            defaultPreset: 'thumb',
            permittedBackgroundColors: ['#ffffff'],
        });
        const result = strategy.getImageTransformParameters({
            input: { ...baseInput, backgroundColor: '#ffffff' },
            availablePresets: presets,
            req: {} as any,
        });
        expect(result.backgroundColor).toBe('#ffffff');
    });
});

// #5568 - generated images must keep the XMP packet of the source, e.g. an AI provenance marking
describe('transformImage metadata', () => {
    const baseParameters = {
        width: 100,
        height: 100,
        mode: 'resize' as const,
        quality: undefined,
        format: undefined,
        fpx: undefined,
        fpy: undefined,
        preset: undefined,
        backgroundColor: undefined,
    };

    for (const format of ['jpeg', 'png', 'webp'] as const) {
        it(`keeps XMP when resizing a ${format} source`, async () => {
            const result = await transformImage(await createImageWithXmp(format), baseParameters);
            expect(await hasDigitalSourceType(await result.toBuffer())).toBe(true);
        });
    }

    it('keeps XMP when cropping to a focal point', async () => {
        const result = await transformImage(await createImageWithXmp('jpeg'), {
            ...baseParameters,
            mode: 'crop',
            fpx: 0.2,
            fpy: 0.8,
        });
        expect(await hasDigitalSourceType(await result.toBuffer())).toBe(true);
    });

    it('keeps XMP when converting the format', async () => {
        const result = await transformImage(await createImageWithXmp('jpeg'), {
            ...baseParameters,
            format: 'webp',
            quality: 80,
        });
        expect(await hasDigitalSourceType(await result.toBuffer())).toBe(true);
    });

    it('keeps only XMP, not EXIF', async () => {
        const result = await transformImage(await createImageWithXmp('jpeg'), baseParameters);
        const buffer = await result.toBuffer();
        expect(await hasDigitalSourceType(buffer)).toBe(true);
        expect((await sharp(buffer).metadata()).exif).toBeUndefined();
    });
});
