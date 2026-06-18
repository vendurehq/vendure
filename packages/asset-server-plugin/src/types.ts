import {
    AssetNamingStrategy,
    AssetPreviewStrategy,
    AssetStorageStrategy,
    RequestContext,
} from '@vendure/core';

import { ImageTransformStrategy } from './config/image-transform-strategy';

export type ImageTransformFormat = 'jpg' | 'jpeg' | 'png' | 'webp' | 'avif';

/**
 * @description
 * Specifies the way in which an asset preview image will be resized to fit in the
 * proscribed dimensions:
 *
 * * crop: crops the image to cover both provided dimensions
 * * resize: Preserving aspect ratio, resizes the image to be as large as possible
 * while ensuring its dimensions are less than or equal to both those specified.
 *
 * @docsCategory core plugins/AssetServerPlugin
 */
export type ImageTransformMode = 'crop' | 'resize';

/**
 * @description
 * A configuration option for an image size preset for the AssetServerPlugin.
 *
 * Presets allow a shorthand way to generate a thumbnail preview of an asset. For example,
 * the built-in "tiny" preset generates a 50px x 50px cropped preview, which can be accessed
 * by appending the string `preset=tiny` to the asset url:
 *
 * `http://localhost:3000/assets/some-asset.jpg?preset=tiny`
 *
 * is equivalent to:
 *
 * `http://localhost:3000/assets/some-asset.jpg?w=50&h=50&mode=crop`
 *
 * @docsCategory core plugins/AssetServerPlugin
 */
export interface ImageTransformPreset {
    name: string;
    width: number;
    height: number;
    mode: ImageTransformMode;
}

/**
 * @description
 * A configuration option for the Cache-Control header in the AssetServerPlugin asset response.
 *
 * @docsCategory core plugins/AssetServerPlugin
 */
export type CacheConfig = {
    /**
     * @description
     * The max-age=N response directive indicates that the response remains fresh until N seconds after the response is generated.
     */
    maxAge: number;
    /**
     * @description
     * The `private` response directive indicates that the response can be stored only in a private cache (e.g. local caches in browsers).
     * The `public` response directive indicates that the response can be stored in a shared cache.
     */
    restriction?: 'public' | 'private';
};

/**
 * @description
 * The configuration options for the AssetServerPlugin.
 *
 * @docsCategory core plugins/AssetServerPlugin
 */
export interface AssetServerOptions {
    /**
     * @description
     * The route to the asset server.
     */
    route: string;
    /**
     * @description
     * The local directory to which assets will be uploaded when using the {@link LocalAssetStorageStrategy}.
     */
    assetUploadDir: string; // TODO: this is strategy-specific and should be moved out of the global options
    /**
     * @description
     * The complete URL prefix of the asset files. For example, "https://demo.vendure.io/assets/". A
     * function can also be provided to handle more complex cases, such as serving multiple domains
     * from a single server. In this case, the function should return a string url prefix.
     *
     * If not provided, the plugin will attempt to guess based off the incoming
     * request and the configured route. However, in all but the simplest cases,
     * this guess may not yield correct results.
     */
    assetUrlPrefix?: string | ((ctx: RequestContext, identifier: string) => string);
    /**
     * @description
     * The max width in pixels of a generated preview image.
     *
     * @default 1600
     * @deprecated Use `previewStrategy: new SharpAssetPreviewStrategy({ maxWidth })` instead
     */
    previewMaxWidth?: number;
    /**
     * @description
     * The max height in pixels of a generated preview image.
     *
     * @default 1600
     * @deprecated Use `previewStrategy: new SharpAssetPreviewStrategy({ maxHeight })` instead
     */
    previewMaxHeight?: number;
    /**
     * @description
     * An array of additional {@link ImageTransformPreset} objects.
     */
    presets?: ImageTransformPreset[];
    /**
     * @description
     * The strategy or strategies to use to determine the parameters for transforming an image.
     * This can be used to implement custom image transformation logic, for example to
     * limit transform parameters to a known set of presets.
     *
     * If multiple strategies are provided, they will be executed in the order in which they are defined.
     * If a strategy throws an error, the image transformation will be aborted and the error
     * will be logged, with an HTTP 400 response sent to the client.
     *
     * @since 3.1.0
     * @default []
     */
    imageTransformStrategy?: ImageTransformStrategy | ImageTransformStrategy[];
    /**
     * @description
     * Defines how asset files and preview images are named before being saved.
     *
     * @default HashedAssetNamingStrategy
     */
    namingStrategy?: AssetNamingStrategy;
    /**
     * @description
     * Defines how previews are generated for a given Asset binary. By default, this uses
     * the {@link SharpAssetPreviewStrategy}
     *
     * @since 1.7.0
     */
    previewStrategy?: AssetPreviewStrategy;
    /**
     * @description
     * A function which can be used to configure an {@link AssetStorageStrategy}. This is useful e.g. if you wish to store your assets
     * using a cloud storage provider. By default, the {@link LocalAssetStorageStrategy} is used.
     *
     * @default () => LocalAssetStorageStrategy
     */
    storageStrategyFactory?: (
        options: AssetServerOptions,
    ) => AssetStorageStrategy | Promise<AssetStorageStrategy>;
    /**
     * @description
     * Configures the `Cache-Control` directive for response to control caching in browsers and shared caches (e.g. Proxies, CDNs).
     * Defaults to publicly cached for 6 months.
     *
     * @default 'public, max-age=15552000'
     * @since 1.9.3
     */
    cacheHeader?: CacheConfig | string;
}
