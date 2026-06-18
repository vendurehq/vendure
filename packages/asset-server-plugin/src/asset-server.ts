import { Inject, Injectable } from '@nestjs/common';
import { AssetStorageStrategy, ConfigService, Logger, ProcessContext } from '@vendure/core';
import { createHash } from 'crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'fs-extra';
import path from 'path';

import { getValidFormat } from './common';
import { ImageTransformParameters, ImageTransformStrategy } from './config/image-transform-strategy';
import { S3AssetStorageStrategy } from './config/s3-asset-storage-strategy';
import { ASSET_SERVER_PLUGIN_INIT_OPTIONS, DEFAULT_CACHE_HEADER, loggerCtx } from './constants';
import { transformImage } from './transform-image';
import { AssetServerOptions, ImageTransformMode, ImageTransformPreset } from './types';

async function getFileType(buffer: Buffer) {
    const { fileTypeFromBuffer } = await import('file-type');
    return fileTypeFromBuffer(buffer);
}

/**
 * This houses the actual Express server that handles incoming requests, performs image transformations,
 * caches the results, and serves the transformed images.
 */
@Injectable()
export class AssetServer {
    private readonly assetStorageStrategy: AssetStorageStrategy;
    private readonly cacheDir = 'cache';
    private cacheHeader: string;
    private presets: ImageTransformPreset[];
    private imageTransformStrategies: ImageTransformStrategy[];

    constructor(
        @Inject(ASSET_SERVER_PLUGIN_INIT_OPTIONS) private options: AssetServerOptions,
        private configService: ConfigService,
        private processContext: ProcessContext,
    ) {
        this.assetStorageStrategy = this.configService.assetOptions.assetStorageStrategy;
    }

    /** @internal */
    onApplicationBootstrap() {
        if (this.processContext.isWorker) {
            return;
        }
        // Configure Cache-Control header
        const { cacheHeader } = this.options;
        if (!cacheHeader) {
            this.cacheHeader = DEFAULT_CACHE_HEADER;
        } else {
            if (typeof cacheHeader === 'string') {
                this.cacheHeader = cacheHeader;
            } else {
                this.cacheHeader = [cacheHeader.restriction, `max-age: ${cacheHeader.maxAge}`]
                    .filter(value => !!value)
                    .join(', ');
            }
        }

        const cachePath = path.join(this.options.assetUploadDir, this.cacheDir);
        fs.ensureDirSync(cachePath);
    }

    /**
     * Creates the image server instance
     */
    createAssetServer(serverConfig: {
        presets: ImageTransformPreset[];
        imageTransformStrategies: ImageTransformStrategy[];
    }): express.Router {
        this.presets = serverConfig.presets;
        this.imageTransformStrategies = serverConfig.imageTransformStrategies;
        const assetServer = express.Router();
        assetServer.use(this.sendAsset(), this.generateTransformedImage());
        return assetServer;
    }

    /**
     * Reads the file requested and send the response to the browser.
     */
    private sendAsset() {
        return async (req: Request, res: Response, next: NextFunction) => {
            let params: ImageTransformParameters;
            try {
                params = await this.getImageTransformParameters(req);
            } catch (e: any) {
                Logger.error(e.message, loggerCtx);
                res.status(400).send('Invalid parameters');
                return;
            }
            const key = this.getFileNameFromParameters(req.path, params);
            try {
                const file = await this.assetStorageStrategy.readFileToBuffer(key);
                let mimeType = this.getMimeType(key);
                if (!mimeType) {
                    mimeType = (await getFileType(file))?.mime || 'application/octet-stream';
                }
                res.contentType(mimeType);
                res.setHeader('content-security-policy', "default-src 'self'");
                res.setHeader('Cache-Control', this.cacheHeader);
                res.send(file);
            } catch (e: any) {
                const err = new Error('File not found');
                (err as any).status = 404;
                return next(err);
            }
        };
    }

    /**
     * If an exception was thrown by the first handler, then it may be because a transformed image
     * is being requested which does not yet exist. In this case, this handler will generate the
     * transformed image, save it to cache, and serve the result as a response.
     */
    private generateTransformedImage() {
        return async (err: any, req: Request, res: Response, next: NextFunction) => {
            if (err && (err.status === 404 || err.statusCode === 404)) {
                if (req.query) {
                    const decodedReqPath = this.sanitizeFilePath(req.path);
                    Logger.debug(`Pre-cached Asset not found: ${decodedReqPath}`, loggerCtx);
                    let file: Buffer;
                    try {
                        file = await this.assetStorageStrategy.readFileToBuffer(decodedReqPath);
                    } catch (_err: any) {
                        res.status(404).send('Resource not found');
                        return;
                    }
                    try {
                        const parameters = await this.getImageTransformParameters(req);
                        const image = await transformImage(file, parameters);
                        const imageBuffer = await image.toBuffer();
                        const cachedFileName = this.getFileNameFromParameters(req.path, parameters);
                        if (!req.query.cache || req.query.cache === 'true') {
                            await this.assetStorageStrategy.writeFileFromBuffer(cachedFileName, imageBuffer);
                            Logger.debug(`Saved cached asset: ${cachedFileName}`, loggerCtx);
                        }
                        let mimeType = this.getMimeType(cachedFileName);
                        if (!mimeType) {
                            mimeType = (await getFileType(imageBuffer))?.mime || 'image/jpeg';
                        }
                        res.set('Content-Type', mimeType);
                        res.setHeader('content-security-policy', "default-src 'self'");
                        res.send(imageBuffer);
                        return;
                    } catch (e: any) {
                        Logger.error(e.message, loggerCtx, e.stack);
                        res.status(500).send('An error occurred when generating the image');
                        return;
                    }
                }
            }
            next();
        };
    }

    private async getImageTransformParameters(req: Request): Promise<ImageTransformParameters> {
        let parameters = this.getInitialImageTransformParameters(req.query as any);
        for (const strategy of this.imageTransformStrategies) {
            try {
                parameters = await strategy.getImageTransformParameters({
                    req,
                    input: { ...parameters },
                    availablePresets: this.presets,
                });
            } catch (e: any) {
                Logger.error(`Error applying ImageTransformStrategy: ` + (e.message as string), loggerCtx);
                throw e;
            }
        }

        let targetWidth: number | undefined = parameters.width;
        let targetHeight: number | undefined = parameters.height;
        let targetMode: ImageTransformMode | undefined = parameters.mode;

        if (parameters.preset) {
            const matchingPreset = this.presets.find(p => p.name === parameters.preset);
            if (matchingPreset) {
                targetWidth = matchingPreset.width;
                targetHeight = matchingPreset.height;
                targetMode = matchingPreset.mode;
            }
        }
        return {
            ...parameters,
            width: targetWidth,
            height: targetHeight,
            mode: targetMode,
        };
    }

    private getInitialImageTransformParameters(
        queryParams: Record<string, string>,
    ): ImageTransformParameters {
        const width = Math.round(+queryParams.w) || undefined;
        const height = Math.round(+queryParams.h) || undefined;
        const quality =
            queryParams.q != null ? Math.round(Math.max(Math.min(+queryParams.q, 100), 1)) : undefined;
        const mode: ImageTransformMode = queryParams.mode === 'resize' ? 'resize' : 'crop';
        const fpx = +queryParams.fpx || undefined;
        const fpy = +queryParams.fpy || undefined;
        const format = getValidFormat(queryParams.format);

        return {
            width,
            height,
            quality,
            format,
            mode,
            fpx,
            fpy,
            preset: queryParams.preset,
        };
    }

    private getFileNameFromParameters(filePath: string, params: ImageTransformParameters): string {
        const { width: w, height: h, mode, preset, fpx, fpy, format, quality: q } = params;
        /* eslint-disable @typescript-eslint/restrict-template-expressions */
        const focalPoint = fpx && fpy ? `_fpx${fpx}_fpy${fpy}` : '';
        const quality = q ? `_q${q}` : '';
        const imageFormat = getValidFormat(format);
        let imageParamsString = '';
        if (w || h) {
            const width = w || '';
            const height = h || '';
            imageParamsString = `_transform_w${width}_h${height}_m${mode}`;
        } else if (preset) {
            if (this.presets && !!this.presets.find(p => p.name === preset)) {
                imageParamsString = `_transform_pre_${preset}`;
            }
        }

        if (focalPoint) {
            imageParamsString += focalPoint;
        }
        if (imageFormat) {
            imageParamsString += imageFormat;
        }
        if (quality) {
            imageParamsString += quality;
        }

        const decodedReqPath = this.sanitizeFilePath(filePath);
        if (imageParamsString !== '') {
            const imageParamHash = this.md5(imageParamsString);
            return path.join(this.cacheDir, this.addSuffix(decodedReqPath, imageParamHash, imageFormat));
        } else {
            return decodedReqPath;
        }
    }

    /**
     * Sanitize the file path to prevent directory traversal attacks.
     */
    private sanitizeFilePath(filePath: string): string {
        let decodedPath: string;
        try {
            decodedPath = decodeURIComponent(filePath);
        } catch (e: any) {
            Logger.error((e.message as string) + ': ' + filePath, loggerCtx);
            return '';
        }
        if (this.assetStorageStrategy instanceof S3AssetStorageStrategy) {
            // For S3 storage, we don't need to sanitize the path because
            // directory traversal attacks are not possible, and modifying the
            // path in this way can cause S3 files to be not found.
            return decodedPath;
        } else {
            // For local storage, we make sure to sanitize the path to prevent directory traversal attacks.
            const normalizedPath = path.normalize(decodedPath);
            let sanitizedPath = normalizedPath;
            let previousPath;
            do {
                previousPath = sanitizedPath;
                sanitizedPath = previousPath.replace(/(\.\.[\\/])+/g, '');
            } while (sanitizedPath !== previousPath);
            return sanitizedPath;
        }
    }

    private md5(input: string): string {
        return createHash('md5').update(input).digest('hex');
    }

    private addSuffix(fileName: string, suffix: string, ext?: string): string {
        const originalExt = path.extname(fileName);
        const effectiveExt = ext ? `.${ext}` : originalExt;
        const baseName = path.basename(fileName, originalExt);
        const dirName = path.dirname(fileName);
        return path.join(dirName, `${baseName}${suffix}${effectiveExt}`);
    }

    /**
     * Attempt to get the mime type from the file name.
     */
    private getMimeType(fileName: string): string | undefined {
        const ext = path.extname(fileName);
        switch (ext) {
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.png':
                return 'image/png';
            case '.gif':
                return 'image/gif';
            case '.svg':
                return 'image/svg+xml';
            case '.tiff':
                return 'image/tiff';
            case '.webp':
                return 'image/webp';
        }
    }
}
