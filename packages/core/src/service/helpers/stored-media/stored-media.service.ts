import { Injectable } from '@nestjs/common';
import { AssetType } from '@vendure/common/lib/generated-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { imageSize } from 'image-size';
import mime from 'mime-types';
import { Readable } from 'stream';
import { EntityManager } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { TRANSACTION_MANAGER_KEY } from '../../../common/constants';
import { MimeTypeError } from '../../../common/error/generated-graphql-admin-errors';
import { getAssetType } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import {
    TransactionSubscriber,
    TransactionSubscriberError,
} from '../../../connection/transaction-subscriber';

const CONTENT_DETECTION_SAMPLE_BYTES = 4100;

export interface StoredMedia {
    type: AssetType;
    width: number;
    height: number;
    fileSize: number;
    mimeType: string;
    source: string;
    preview: string;
}

/**
 * @description
 * A file supplied programmatically to Vendure's stored-media pipeline. The stream is validated,
 * persisted and converted into an Asset preview in the same way as a GraphQL file upload.
 *
 * @docsCategory assets
 */
export interface StoredMediaUpload {
    createReadStream: () => Readable;
    filename: string;
    mimetype: string;
}

async function detectMimeTypeFromContents(buffer: Buffer): Promise<string | undefined> {
    const { fileTypeFromBuffer } = await import('file-type');
    const result = await fileTypeFromBuffer(buffer);
    return result?.mime;
}

function peekStreamHead(stream: Readable, byteCount: number): Promise<{ head: Buffer; complete: boolean }> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const cleanup = () => {
            stream.removeListener('readable', onReadable);
            stream.removeListener('end', onEnd);
            stream.removeListener('error', onError);
        };
        const onEnd = () => {
            cleanup();
            resolve({ head: Buffer.concat(chunks), complete: true });
        };
        const onError = (err: Error) => {
            cleanup();
            reject(err);
        };
        const onReadable = () => {
            let chunk: Buffer | null;
            // eslint-disable-next-line no-cond-assign
            while ((chunk = stream.read()) !== null) {
                chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
                size += chunks[chunks.length - 1].length;
                if (size >= byteCount) {
                    cleanup();
                    const head = Buffer.concat(chunks);
                    stream.unshift(head);
                    resolve({ head, complete: false });
                    return;
                }
            }
        };
        stream.on('readable', onReadable);
        stream.on('end', onEnd);
        stream.on('error', onError);
    });
}

/**
 * Owns validation and persistence of uploaded files. Callers remain responsible for
 * persisting domain metadata and cleaning up stored files when that persistence fails.
 */
@Injectable()
export class StoredMediaService {
    private readonly permittedMimeTypes: Array<{ type: string; subtype: string }>;

    constructor(
        private readonly configService: ConfigService,
        private readonly transactionSubscriber: TransactionSubscriber,
    ) {
        this.permittedMimeTypes = this.configService.assetOptions.permittedFileTypes
            .map(value => (/\.[\w]+/.test(value) ? mime.lookup(value) || undefined : value))
            .filter(notNullOrUndefined)
            .map(value => {
                const [type, subtype] = value.split('/');
                return { type, subtype };
            });
    }

    async storeUpload(
        ctx: RequestContext,
        upload: Promise<StoredMediaUpload> | StoredMediaUpload,
        options: { imageOnly?: boolean } = {},
    ): Promise<StoredMedia | MimeTypeError> {
        const { createReadStream, filename, mimetype } = await upload;
        const { stream, errorPromise } = this.makeStreamGuard(createReadStream);
        return Promise.race([this.storeStream(ctx, stream, filename, mimetype, options), errorPromise]);
    }

    async storeStream(
        ctx: RequestContext,
        stream: Readable,
        filename: string,
        mimetype: string,
        options: { imageOnly?: boolean } = {},
    ): Promise<StoredMedia | MimeTypeError> {
        const { head, complete } = await peekStreamHead(stream, CONTENT_DETECTION_SAMPLE_BYTES);
        const contentMimeType = await detectMimeTypeFromContents(head);
        const mimeTypeError = this.getMimeTypeError(filename, mimetype, contentMimeType, options.imageOnly);
        if (mimeTypeError) {
            return mimeTypeError;
        }
        const canonicalMimeType = this.getCanonicalMimeType(filename, mimetype, contentMimeType);

        const { assetPreviewStrategy, assetStorageStrategy } = this.configService.assetOptions;
        const sourceFileName = await this.getSourceFileName(ctx, filename);
        const previewFileName = await this.getPreviewFileName(ctx, sourceFileName);
        let source: string | undefined;
        let preview: string | undefined;

        try {
            source = complete
                ? await assetStorageStrategy.writeFileFromBuffer(sourceFileName, head)
                : await assetStorageStrategy.writeFileFromStream(sourceFileName, stream);
            const sourceFile = await assetStorageStrategy.readFileToBuffer(source);
            const previewBuffer = await assetPreviewStrategy.generatePreviewImage(
                ctx,
                canonicalMimeType,
                sourceFile,
            );
            preview = await assetStorageStrategy.writeFileFromBuffer(previewFileName, previewBuffer);
            const type = getAssetType(canonicalMimeType);
            const { width, height } = this.getDimensions(
                type === AssetType.IMAGE ? sourceFile : previewBuffer,
            );
            return {
                type,
                width,
                height,
                fileSize: sourceFile.byteLength,
                mimeType: canonicalMimeType,
                source,
                preview,
            };
        } catch (error) {
            await this.delete({ source, preview });
            throw error;
        }
    }

    async delete(media: Pick<StoredMedia, 'source' | 'preview'> | { source?: string; preview?: string }) {
        const { assetStorageStrategy } = this.configService.assetOptions;
        const identifiers = [media.source, media.preview].filter(notNullOrUndefined);
        await Promise.all(
            identifiers.map(async identifier => {
                try {
                    await assetStorageStrategy.deleteFile(identifier);
                } catch (error: any) {
                    Logger.error('error.could-not-delete-asset-file', undefined, error?.stack);
                }
            }),
        );
    }

    /** @internal */
    registerRollbackCleanup(
        ctx: RequestContext,
        media: Pick<StoredMedia, 'source' | 'preview'>,
    ): () => Promise<void> {
        let cleanedUp = false;
        const cleanup = async () => {
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;
            await this.delete(media);
        };
        const queryRunner = this.getActiveQueryRunner(ctx);
        if (queryRunner) {
            void this.transactionSubscriber
                .awaitRollback(queryRunner)
                .then(cleanup)
                .catch(error => this.ignoreOppositeTransactionOutcome(error));
        }
        return cleanup;
    }

    /** @internal */
    async deleteOnCommit(ctx: RequestContext, media: Pick<StoredMedia, 'source' | 'preview'>): Promise<void> {
        const queryRunner = this.getActiveQueryRunner(ctx);
        if (!queryRunner) {
            await this.delete(media);
            return;
        }
        void this.transactionSubscriber
            .awaitCommit(queryRunner)
            .then(() => this.delete(media))
            .catch(error => this.ignoreOppositeTransactionOutcome(error));
    }

    private getMimeTypeError(
        filename: string,
        declaredMimeType: string,
        contentMimeType: string | undefined,
        imageOnly = false,
    ): MimeTypeError | undefined {
        const isAllowed = (value: string) =>
            this.validateMimeType(value) && (!imageOnly || value.startsWith('image/'));
        if (!isAllowed(declaredMimeType)) {
            return new MimeTypeError({ fileName: filename, mimeType: declaredMimeType });
        }
        const extensionMimeType = mime.lookup(filename) || undefined;
        if (extensionMimeType && !isAllowed(extensionMimeType)) {
            return new MimeTypeError({ fileName: filename, mimeType: extensionMimeType });
        }
        if (contentMimeType && !isAllowed(contentMimeType)) {
            const contentIsGenericXml =
                contentMimeType === 'application/xml' || contentMimeType === 'text/xml';
            const extensionIsXmlBased = !!extensionMimeType && extensionMimeType.endsWith('+xml');
            if (!(contentIsGenericXml && extensionIsXmlBased)) {
                return new MimeTypeError({ fileName: filename, mimeType: contentMimeType });
            }
        }
        if (!contentMimeType && !extensionMimeType) {
            return new MimeTypeError({ fileName: filename, mimeType: 'application/octet-stream' });
        }
    }

    private getCanonicalMimeType(
        filename: string,
        declaredMimeType: string,
        contentMimeType: string | undefined,
    ): string {
        const extensionMimeType = mime.lookup(filename) || undefined;
        const contentIsGenericXml = contentMimeType === 'application/xml' || contentMimeType === 'text/xml';
        const extensionIsXmlBased = !!extensionMimeType && extensionMimeType.endsWith('+xml');
        if (contentMimeType && !(contentIsGenericXml && extensionIsXmlBased)) {
            return contentMimeType;
        }
        return extensionMimeType || declaredMimeType;
    }

    private getActiveQueryRunner(ctx: RequestContext) {
        const transactionManager = (ctx as any)[TRANSACTION_MANAGER_KEY] as EntityManager | undefined;
        const queryRunner = transactionManager?.queryRunner;
        return queryRunner?.isTransactionActive ? queryRunner : undefined;
    }

    private ignoreOppositeTransactionOutcome(error: unknown) {
        if (!(error instanceof TransactionSubscriberError)) {
            const trace = error instanceof Error ? error.stack : String(error);
            Logger.error('Could not coordinate stored media with transaction outcome', undefined, trace);
        }
    }

    private validateMimeType(mimeType: string): boolean {
        const [type, subtype] = mimeType.split('/');
        return this.permittedMimeTypes.some(
            match => match.type === type && (match.subtype === subtype || match.subtype === '*'),
        );
    }

    private async getSourceFileName(ctx: RequestContext, fileName: string): Promise<string> {
        return this.generateUniqueName(fileName, (name, conflict) =>
            this.configService.assetOptions.assetNamingStrategy.generateSourceFileName(ctx, name, conflict),
        );
    }

    private async getPreviewFileName(ctx: RequestContext, fileName: string): Promise<string> {
        return this.generateUniqueName(fileName, (name, conflict) =>
            this.configService.assetOptions.assetNamingStrategy.generatePreviewFileName(ctx, name, conflict),
        );
    }

    private async generateUniqueName(
        input: string,
        generate: (fileName: string, conflictName?: string) => string,
    ): Promise<string> {
        let output: string | undefined;
        do {
            output = generate(input, output);
        } while (await this.configService.assetOptions.assetStorageStrategy.fileExists(output));
        return output;
    }

    private getDimensions(image: Buffer): { width: number; height: number } {
        try {
            const { width, height } = imageSize(image);
            return { width: width ?? 0, height: height ?? 0 };
        } catch (error) {
            Logger.error('Could not determine Asset dimensions: ' + JSON.stringify(error));
            return { width: 0, height: 0 };
        }
    }

    private makeStreamGuard(createReadStream: () => Readable) {
        let reject: (error: unknown) => void;
        const errorPromise = new Promise<never>((_, onReject) => {
            reject = onReject;
        });
        const stream = createReadStream();
        stream.on('error', error => reject(error));
        return { stream, errorPromise };
    }
}
