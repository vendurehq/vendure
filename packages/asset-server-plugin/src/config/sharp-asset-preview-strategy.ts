import { AssetType } from '@vendure/common/lib/generated-types';
import { AssetPreviewStrategy, getAssetType, Logger, RequestContext } from '@vendure/core';
import path from 'path';
import sharp from 'sharp';

import { loggerCtx } from '../constants';

/**
 * @description
 * This {@link AssetPreviewStrategy} uses the [Sharp library](https://sharp.pixelplumbing.com/) to generate
 * preview images of uploaded binary files. For non-image binaries, a generic "file" icon with the mime type
 * overlay will be generated.
 *
 * @docsCategory core plugins/AssetServerPlugin
 * @docsPage SharpAssetPreviewStrategy
 */
interface SharpAssetPreviewConfig {
    /**
     * @description
     * The max height in pixels of a generated preview image.
     *
     * @default 1600
     */
    maxHeight?: number;
    /**
     * @description
     * The max width in pixels of a generated preview image.
     *
     * @default 1600
     */
    maxWidth?: number;
    /**
     * @description
     * Set Sharp's options for encoding jpeg files: https://sharp.pixelplumbing.com/api-output#jpeg
     *
     * @since 1.7.0
     */
    jpegOptions?: sharp.JpegOptions;
    /**
     * @description
     * Set Sharp's options for encoding png files: https://sharp.pixelplumbing.com/api-output#png
     *
     * @since 1.7.0
     */
    pngOptions?: sharp.PngOptions;
    /**
     * @description
     * Set Sharp's options for encoding webp files: https://sharp.pixelplumbing.com/api-output#webp
     *
     * @since 1.7.0
     */
    webpOptions?: sharp.WebpOptions;
    /**
     * @description
     * Set Sharp's options for encoding gif files: https://sharp.pixelplumbing.com/api-output#gif
     *
     * @since 1.7.0
     */
    gifOptions?: sharp.GifOptions;
    /**
     * @description
     * Set Sharp's options for encoding avif files: https://sharp.pixelplumbing.com/api-output#avif
     *
     * @since 1.7.0
     */
    avifOptions?: sharp.AvifOptions;
}

/**
 * @description
 * This {@link AssetPreviewStrategy} uses the [Sharp library](https://sharp.pixelplumbing.com/) to generate
 * preview images of uploaded binary files. For non-image binaries, a generic "file" icon with the mime type
 * overlay will be generated.
 *
 * By default, this strategy will produce previews up to maximum dimensions of 1600 x 1600 pixels. The created
 * preview images will match the input format - so a source file in jpeg format will output a jpeg preview,
 * a webp source file will output a webp preview, and so on.
 *
 * The settings for the outputs will default to Sharp's defaults (https://sharp.pixelplumbing.com/api-output).
 * However, it is possible to pass your own configurations to control the output of each format:
 *
 * ```ts
 * AssetServerPlugin.init({
 *   previewStrategy: new SharpAssetPreviewStrategy({
 *     jpegOptions: { quality: 95 },
 *     webpOptions: { quality: 95 },
 *   }),
 * }),
 * ```
 *
 * @docsCategory core plugins/AssetServerPlugin
 * @docsPage SharpAssetPreviewStrategy
 * @docsWeight 0
 */
export class SharpAssetPreviewStrategy implements AssetPreviewStrategy {
    private readonly defaultConfig: Required<SharpAssetPreviewConfig> = {
        maxHeight: 1600,
        maxWidth: 1600,
        jpegOptions: {},
        pngOptions: {},
        webpOptions: {},
        gifOptions: {},
        avifOptions: {},
    };
    private readonly config: Required<SharpAssetPreviewConfig>;

    constructor(config?: SharpAssetPreviewConfig) {
        this.config = {
            ...this.defaultConfig,
            ...(config ?? {}),
        };
    }

    async generatePreviewImage(ctx: RequestContext, mimeType: string, data: Buffer): Promise<Buffer> {
        const assetType = getAssetType(mimeType);

        const { maxWidth, maxHeight } = this.config;

        if (assetType === AssetType.IMAGE) {
            try {
                const image = sharp(data, { failOn: 'truncated' }).rotate();
                const metadata = await image.metadata();
                const width = metadata.width || 0;
                const height = metadata.height || 0;
                if (maxWidth < width || maxHeight < height) {
                    image.resize(maxWidth, maxHeight, { fit: 'inside' });
                }
                if (mimeType === 'image/svg+xml') {
                    // Convert the SVG to a raster for the preview
                    return image.toBuffer();
                } else {
                    switch (metadata.format) {
                        case 'jpeg':
                        case 'jpg':
                            return image.jpeg(this.config.jpegOptions).toBuffer();
                        case 'png':
                            return image.png(this.config.pngOptions).toBuffer();
                        case 'webp':
                            return image.webp(this.config.webpOptions).toBuffer();
                        case 'gif':
                            return image.gif(this.config.jpegOptions).toBuffer();
                        case 'avif':
                            return image.avif(this.config.avifOptions).toBuffer();
                        default:
                            return image.toBuffer();
                    }
                }
            } catch (err: any) {
                Logger.error(
                    `An error occurred when generating preview for image with mimeType ${mimeType}: ${JSON.stringify(
                        err.message,
                    )}`,
                    loggerCtx,
                );
                return this.generateBinaryFilePreview(mimeType);
            }
        } else {
            return this.generateBinaryFilePreview(mimeType);
        }
    }

    private generateMimeTypeOverlay(mimeType: string): Buffer {
        return Buffer.from(`
            <svg xmlns="http://www.w3.org/2000/svg" height="150" width="800">
            <style>
                text {
                   font-size: 64px;
                   font-family: Arial, sans-serif;
                   fill: #666;
                }
              </style>

              <text x="400" y="110"  text-anchor="middle" width="800">${mimeType}</text>
            </svg>`);
    }

    private generateBinaryFilePreview(mimeType: string): Promise<Buffer> {
        return sharp(path.join(__dirname, '..', 'file-icon.png'))
            .resize(800, 800, { fit: 'outside' })
            .composite([
                {
                    input: this.generateMimeTypeOverlay(mimeType),
                    gravity: sharp.gravity.center,
                },
            ])
            .toBuffer();
    }
}
