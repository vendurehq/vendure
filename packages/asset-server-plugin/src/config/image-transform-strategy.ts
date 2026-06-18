import { InjectableStrategy } from '@vendure/core';
import { Request } from 'express';

import { ImageTransformFormat, ImageTransformMode, ImageTransformPreset } from '../types';

/**
 * @description
 * Parameters which are used to transform the image.
 *
 * @docsCategory core plugins/AssetServerPlugin
 * @since 3.1.0
 * @docsPage ImageTransformStrategy
 */
export interface ImageTransformParameters {
    width: number | undefined;
    height: number | undefined;
    mode: ImageTransformMode | undefined;
    quality: number | undefined;
    format: ImageTransformFormat | undefined;
    fpx: number | undefined;
    fpy: number | undefined;
    preset: string | undefined;
}

/**
 * @description
 * The arguments passed to the `getImageTransformParameters` method of an ImageTransformStrategy.
 *
 * @docsCategory core plugins/AssetServerPlugin
 * @since 3.1.0
 * @docsPage ImageTransformStrategy
 */
export interface GetImageTransformParametersArgs {
    req: Request;
    availablePresets: ImageTransformPreset[];
    input: ImageTransformParameters;
}

/**
 * @description
 * An injectable strategy which is used to determine the parameters for transforming an image.
 * This can be used to implement custom image transformation logic, for example to
 * limit transform parameters to a known set of presets.
 *
 * This is set via the `imageTransformStrategy` option in the AssetServerOptions. Multiple
 * strategies can be defined and will be executed in the order in which they are defined.
 *
 * If a strategy throws an error, the image transformation will be aborted and the error
 * will be logged, with an HTTP 400 response sent to the client.
 *
 * @docsCategory core plugins/AssetServerPlugin
 * @docsPage ImageTransformStrategy
 * @docsWeight 0
 * @since 3.1.0
 */
export interface ImageTransformStrategy extends InjectableStrategy {
    /**
     * @description
     * Given the input parameters, return the parameters which should be used to transform the image.
     */
    getImageTransformParameters(
        args: GetImageTransformParametersArgs,
    ): Promise<ImageTransformParameters> | ImageTransformParameters;
}
