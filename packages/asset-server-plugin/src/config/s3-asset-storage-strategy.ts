import { PutObjectRequest, S3ClientConfig } from '@aws-sdk/client-s3';
import { AwsCredentialIdentity, AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { AssetStorageStrategy, Logger } from '@vendure/core';
import { Request } from 'express';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import { getAssetUrlPrefixFn } from '../common';
import { loggerCtx } from '../constants';
import { AssetServerOptions } from '../types';

/**
 * @description
 * Configuration for connecting to AWS S3.
 *
 * @docsCategory core plugins/AssetServerPlugin
 * @docsPage S3AssetStorageStrategy
 */
export interface S3Config {
    /**
     * @description
     * The credentials used to access your s3 account. You can supply either the access key ID & secret, or you can make use of a
     * [shared credentials file](https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/loading-node-credentials-shared.html)
     * To use a shared credentials file, import the `fromIni()` function from the "@aws-sdk/credential-provider-ini" or "@aws-sdk/credential-providers" package and supply
     * the profile name (e.g. `{ profile: 'default' }`) as its argument.
     */
    credentials: AwsCredentialIdentity | AwsCredentialIdentityProvider;
    /**
     * @description
     * The S3 bucket in which to store the assets. If it does not exist, it will be created on startup.
     */
    bucket: string;
    /**
     * @description
     * Configuration object passed directly to the AWS SDK.
     * S3.Types.ClientConfiguration can be used after importing aws-sdk.
     * Using type `any` in order to avoid the need to include `aws-sdk` dependency in general.
     */
    nativeS3Configuration?: any;
    /**
     * @description
     * Configuration object passed directly to the AWS SDK.
     * ManagedUpload.ManagedUploadOptions can be used after importing aws-sdk.
     * Using type `any` in order to avoid the need to include `aws-sdk` dependency in general.
     */
    nativeS3UploadConfiguration?: any;
}

/**
 * @description
 * Returns a configured instance of the {@link S3AssetStorageStrategy} which can then be passed to the {@link AssetServerOptions}
 * `storageStrategyFactory` property.
 *
 * Before using this strategy, make sure you have the `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` package installed:
 *
 * ```sh
 * npm install \@aws-sdk/client-s3 \@aws-sdk/lib-storage
 * ```
 *
 * @example
 * ```ts
 * import { AssetServerPlugin, configureS3AssetStorage } from '\@vendure/asset-server-plugin';
 * import { DefaultAssetNamingStrategy } from '\@vendure/core';
 * import { fromEnv } from '\@aws-sdk/credential-providers';
 *
 * // ...
 *
 * plugins: [
 *   AssetServerPlugin.init({
 *     route: 'assets',
 *     assetUploadDir: path.join(__dirname, 'assets'),
 *     namingStrategy: new DefaultAssetNamingStrategy(),
 *     storageStrategyFactory: configureS3AssetStorage({
 *       bucket: 'my-s3-bucket',
 *       credentials: fromEnv(), // or any other credential provider
 *       nativeS3Configuration: {
 *         region: process.env.AWS_REGION,
 *       },
 *     }),
 * }),
 * ```
 *
 * ## Usage with MinIO
 *
 * Reference: [How to use AWS SDK for Javascript with MinIO Server](https://docs.min.io/docs/how-to-use-aws-sdk-for-javascript-with-minio-server.html)
 *
 * @example
 * ```ts
 * import { AssetServerPlugin, configureS3AssetStorage } from '\@vendure/asset-server-plugin';
 * import { DefaultAssetNamingStrategy } from '\@vendure/core';
 *
 * // ...
 *
 * plugins: [
 *   AssetServerPlugin.init({
 *     route: 'assets',
 *     assetUploadDir: path.join(__dirname, 'assets'),
 *     namingStrategy: new DefaultAssetNamingStrategy(),
 *     storageStrategyFactory: configureS3AssetStorage({
 *       bucket: 'my-minio-bucket',
 *       credentials: {
 *         accessKeyId: process.env.MINIO_ACCESS_KEY_ID,
 *         secretAccessKey: process.env.MINIO_SECRET_ACCESS_KEY,
 *       },
 *       nativeS3Configuration: {
 *         endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
 *         forcePathStyle: true,
 *         signatureVersion: 'v4',
 *         // The `region` is required by the AWS SDK even when using MinIO,
 *         // so we just use a dummy value here.
 *         region: 'eu-west-1',
 *       },
 *     }),
 * }),
 * ```
 * @docsCategory core plugins/AssetServerPlugin
 * @docsPage S3AssetStorageStrategy
 */
export function configureS3AssetStorage(s3Config: S3Config) {
    return (options: AssetServerOptions) => {
        const prefixFn = getAssetUrlPrefixFn(options);
        const toAbsoluteUrlFn = (request: Request, identifier: string): string => {
            if (!identifier) {
                return '';
            }
            const prefix = prefixFn(request, identifier);
            return identifier.startsWith(prefix) ? identifier : `${prefix}${identifier}`;
        };
        return new S3AssetStorageStrategy(s3Config, toAbsoluteUrlFn);
    };
}

/**
 * @description
 * An {@link AssetStorageStrategy} which uses [Amazon S3](https://aws.amazon.com/s3/) object storage service.
 * To us this strategy you must first have access to an AWS account.
 * See their [getting started guide](https://aws.amazon.com/s3/getting-started/) for how to get set up.
 *
 * Before using this strategy, make sure you have the `@aws-sdk/client-s3` and `@aws-sdk/lib-storage` package installed:
 *
 * ```sh
 * npm install \@aws-sdk/client-s3 \@aws-sdk/lib-storage
 * ```
 *
 * **Note:** Rather than instantiating this manually, use the {@link configureS3AssetStorage} function.
 *
 * ## Use with S3-compatible services (MinIO)
 * This strategy will also work with any S3-compatible object storage solutions, such as [MinIO](https://min.io/).
 * See the {@link configureS3AssetStorage} for an example with MinIO.
 *
 * @docsCategory asset-server-plugin
 * @docsPage S3AssetStorageStrategy
 * @docsWeight 0
 */
export class S3AssetStorageStrategy implements AssetStorageStrategy {
    private AWS: typeof import('@aws-sdk/client-s3');
    private libStorage: typeof import('@aws-sdk/lib-storage');
    private s3Client: import('@aws-sdk/client-s3').S3Client;

    constructor(
        private s3Config: S3Config,
        public readonly toAbsoluteUrl: (request: Request, identifier: string) => string,
    ) {}

    async init() {
        try {
            this.AWS = await import('@aws-sdk/client-s3');
        } catch (err: any) {
            Logger.error(
                'Could not find the "@aws-sdk/client-s3" package. Make sure it is installed',
                loggerCtx,
                err.stack,
            );
        }

        try {
            this.libStorage = await import('@aws-sdk/lib-storage');
        } catch (err: any) {
            Logger.error(
                'Could not find the "@aws-sdk/lib-storage" package. Make sure it is installed',
                loggerCtx,
                err.stack,
            );
        }

        const config = {
            ...this.s3Config.nativeS3Configuration,
            credentials: await this.getCredentials(), // Avoid credentials overriden by nativeS3Configuration
        } satisfies S3ClientConfig;

        this.s3Client = new this.AWS.S3Client(config);

        await this.ensureBucket();
    }

    destroy?: (() => void | Promise<void>) | undefined;

    async writeFileFromBuffer(fileName: string, data: Buffer) {
        return this.writeFile(fileName, data);
    }

    async writeFileFromStream(fileName: string, data: Readable) {
        return this.writeFile(fileName, data);
    }

    async readFileToBuffer(identifier: string) {
        const body = await this.readFile(identifier);

        if (!body) {
            Logger.error(`Got undefined Body for ${identifier}`, loggerCtx);
            return Buffer.from('');
        }

        const chunks: Buffer[] = [];
        for await (const chunk of body) {
            chunks.push(chunk);
        }

        return Buffer.concat(chunks);
    }

    async readFileToStream(identifier: string) {
        const body = await this.readFile(identifier);

        if (!body) {
            return new Readable({
                read() {
                    this.push(null);
                },
            });
        }

        return body;
    }

    private async readFile(identifier: string) {
        const { GetObjectCommand } = this.AWS;

        const result = await this.s3Client.send(new GetObjectCommand(this.getObjectParams(identifier)));
        return result.Body as Readable | undefined;
    }

    private async writeFile(fileName: string, data: PutObjectRequest['Body'] | string | Uint8Array | Buffer) {
        const { Upload } = this.libStorage;

        const upload = new Upload({
            client: this.s3Client,
            params: {
                ...this.s3Config.nativeS3UploadConfiguration,
                Bucket: this.s3Config.bucket,
                Key: fileName,
                Body: data,
            },
        });

        return upload.done().then(result => {
            if (!('Key' in result) || !result.Key) {
                Logger.error(`Got undefined Key for ${fileName}`, loggerCtx);
                throw new Error(`Got undefined Key for ${fileName}`);
            }

            return result.Key;
        });
    }

    async deleteFile(identifier: string) {
        const { DeleteObjectCommand } = this.AWS;
        await this.s3Client.send(new DeleteObjectCommand(this.getObjectParams(identifier)));
    }

    async fileExists(fileName: string) {
        const { HeadObjectCommand } = this.AWS;

        try {
            await this.s3Client.send(new HeadObjectCommand(this.getObjectParams(fileName)));
            return true;
        } catch (err: any) {
            return false;
        }
    }

    private getObjectParams(identifier: string) {
        return {
            Bucket: this.s3Config.bucket,
            Key: path.join(identifier.replace(/^\//, '')),
        };
    }

    private async ensureBucket(bucket = this.s3Config.bucket) {
        const { HeadBucketCommand, CreateBucketCommand } = this.AWS;

        try {
            await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
            Logger.verbose(`Found S3 bucket "${bucket}"`, loggerCtx);
            return;
        } catch (err: any) {
            Logger.verbose(
                `Could not find bucket "${bucket}: ${JSON.stringify(err.message)}". Attempting to create...`,
            );
        }

        try {
            await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket, ACL: 'private' }));
            Logger.verbose(`Created S3 bucket "${bucket}"`, loggerCtx);
        } catch (err: any) {
            Logger.error(
                `Could not find nor create the S3 bucket "${bucket}: ${JSON.stringify(err.message)}"`,
                loggerCtx,
                err.stack,
            );
        }
    }

    private async getCredentials() {
        if (this.s3Config.credentials == null) {
            return undefined;
        }

        if (this.isCredentialsProfile(this.s3Config.credentials)) {
            Logger.warn(
                'The "profile" property of the "s3Config.credentials" is deprecated. ' +
                    'Please use the "fromIni()" function from the "@aws-sdk/credential-provider-ini" or "@aws-sdk/credential-providers" package instead.',
                loggerCtx,
            );
            return (await import('@aws-sdk/credential-provider-ini')).fromIni({
                profile: this.s3Config.credentials.profile,
            });
        }

        return this.s3Config.credentials;
    }

    private isCredentialsProfile(
        credentials: AwsCredentialIdentity | AwsCredentialIdentityProvider,
    ): credentials is AwsCredentialIdentity & { profile: string } {
        return (
            credentials !== null &&
            typeof credentials === 'object' &&
            'profile' in credentials &&
            Object.keys(credentials).length === 1
        );
    }
}
