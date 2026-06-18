import { describe, expect, it } from 'vitest';

import { RequestContext } from '../../api/common/request-context';

import { DefaultAssetNamingStrategy } from './default-asset-naming-strategy';

describe('DefaultAssetNamingStrategy', () => {
    const ctx = RequestContext.empty();

    describe('generateSourceFileName()', () => {
        it('normalizes file names', () => {
            const strategy = new DefaultAssetNamingStrategy();

            expect(strategy.generateSourceFileName(ctx, 'foo.jpg')).toBe('foo.jpg');
            expect(strategy.generateSourceFileName(ctx, 'curaçao.jpg')).toBe('curacao.jpg');
            expect(strategy.generateSourceFileName(ctx, 'dấu hỏi.jpg')).toBe('dau-hoi.jpg');
        });

        it('increments conflicting file names', () => {
            const strategy = new DefaultAssetNamingStrategy();

            expect(strategy.generateSourceFileName(ctx, 'foo.jpg', 'foo.jpg')).toBe('foo__02.jpg');
            expect(strategy.generateSourceFileName(ctx, 'foo.jpg', 'foo__02.jpg')).toBe('foo__03.jpg');
            expect(strategy.generateSourceFileName(ctx, 'foo.jpg', 'foo__09.jpg')).toBe('foo__10.jpg');
            expect(strategy.generateSourceFileName(ctx, 'foo.jpg', 'foo__99.jpg')).toBe('foo__100.jpg');
            expect(strategy.generateSourceFileName(ctx, 'foo.jpg', 'foo__999.jpg')).toBe('foo__1000.jpg');
        });

        it('increments conflicting file names with no extension', () => {
            const strategy = new DefaultAssetNamingStrategy();

            expect(strategy.generateSourceFileName(ctx, 'ext45000000000505', 'ext45000000000505')).toBe(
                'ext45000000000505__02',
            );
            expect(strategy.generateSourceFileName(ctx, 'ext45000000000505', 'ext45000000000505__02')).toBe(
                'ext45000000000505__03',
            );
            expect(strategy.generateSourceFileName(ctx, 'ext45000000000505', 'ext45000000000505__09')).toBe(
                'ext45000000000505__10',
            );
        });
    });

    describe('generatePreviewFileName()', () => {
        it('adds the preview suffix', () => {
            const strategy = new DefaultAssetNamingStrategy();

            expect(strategy.generatePreviewFileName(ctx, 'foo.jpg')).toBe('foo__preview.jpg');
        });

        it('preserves the extension of supported image files', () => {
            const strategy = new DefaultAssetNamingStrategy();

            expect(strategy.generatePreviewFileName(ctx, 'foo.jpg')).toBe('foo__preview.jpg');
            expect(strategy.generatePreviewFileName(ctx, 'foo.jpeg')).toBe('foo__preview.jpeg');
            expect(strategy.generatePreviewFileName(ctx, 'foo.png')).toBe('foo__preview.png');
            expect(strategy.generatePreviewFileName(ctx, 'foo.webp')).toBe('foo__preview.webp');
            expect(strategy.generatePreviewFileName(ctx, 'foo.tiff')).toBe('foo__preview.tiff');
            expect(strategy.generatePreviewFileName(ctx, 'foo.gif')).toBe('foo__preview.gif');
            expect(strategy.generatePreviewFileName(ctx, 'foo.avif')).toBe('foo__preview.avif');
        });

        it('adds a png extension for unsupported images and other files', () => {
            const strategy = new DefaultAssetNamingStrategy();

            expect(strategy.generatePreviewFileName(ctx, 'foo.svg')).toBe('foo__preview.svg.png');
            expect(strategy.generatePreviewFileName(ctx, 'foo.pdf')).toBe('foo__preview.pdf.png');
        });
    });
});
