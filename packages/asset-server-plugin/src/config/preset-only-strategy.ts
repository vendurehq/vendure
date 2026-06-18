import { ImageTransformFormat } from '../types';

import {
    GetImageTransformParametersArgs,
    ImageTransformParameters,
    ImageTransformStrategy,
} from './image-transform-strategy';

/**
 * @description
 * Configuration options for the {@link PresetOnlyStrategy}.
 *
 * @docsCategory core plugins/AssetServerPlugin
 * @docsPage PresetOnlyStrategy
 */
export interface PresetOnlyStrategyOptions {
    /**
     * @description
     * The name of the default preset to use if no preset is specified in the URL.
     */
    defaultPreset: string;
    /**
     * @description
     * The permitted quality of the transformed images. If set to 'any', then any quality is permitted.
     * If set to an array of numbers (0-100), then only those quality values are permitted.
     *
     * @default [0, 50, 75, 85, 95]
     */
    permittedQuality?: number[];
    /**
     * @description
     * The permitted formats of the transformed images. If set to 'any', then any format is permitted.
     * If set to an array of strings e.g. `['jpg', 'webp']`, then only those formats are permitted.
     *
     * @default ['jpg', 'webp', 'avif']
     */
    permittedFormats?: ImageTransformFormat[];
    /**
     * @description
     * Whether to allow the focal point to be specified in the URL.
     *
     * @default false
     */
    allowFocalPoint?: boolean;
}

/**
 * @description
 * An {@link ImageTransformStrategy} which only allows transformations to be made using
 * presets which are defined in the available presets.
 *
 * With this strategy enabled, requests to the asset server must include a `preset` parameter (or use the default preset)
 *
 * This is valid: `http://localhost:3000/assets/some-asset.jpg?preset=medium`
 *
 * This is invalid: `http://localhost:3000/assets/some-asset.jpg?w=200&h=200`, and the dimensions will be ignored.
 *
 * The strategy can be configured to allow only certain quality values and formats, and to
 * optionally allow the focal point to be specified in the URL.
 *
 * If a preset is not found in the available presets, an error will be thrown.
 *
 * @example
 * ```ts
 * import { AssetServerPlugin, PresetOnlyStrategy } from '\@vendure/core';
 *
 * // ...
 *
 * AssetServerPlugin.init({
 *   //...
 *   imageTransformStrategy: new PresetOnlyStrategy({
 *     defaultPreset: 'thumbnail',
 *     permittedQuality: [0, 50, 75, 85, 95],
 *     permittedFormats: ['jpg', 'webp', 'avif'],
 *     allowFocalPoint: true,
 *   }),
 * });
 * ```
 *
 * @docsCategory core plugins/AssetServerPlugin
 * @docsPage PresetOnlyStrategy
 * @docsWeight 0
 * @since 3.1.0
 */
export class PresetOnlyStrategy implements ImageTransformStrategy {
    constructor(private options: PresetOnlyStrategyOptions) {}

    getImageTransformParameters({
        input,
        availablePresets,
    }: GetImageTransformParametersArgs): Promise<ImageTransformParameters> | ImageTransformParameters {
        const presetName = input.preset ?? this.options.defaultPreset;
        const matchingPreset = availablePresets.find(p => p.name === presetName);
        if (!matchingPreset) {
            throw new Error(`Preset "${presetName}" not found`);
        }
        const permittedQuality = this.options.permittedQuality ?? [0, 50, 75, 85, 95];
        const permittedFormats = this.options.permittedFormats ?? ['jpg', 'webp', 'avif'];
        const quality = input.quality && permittedQuality.includes(input.quality) ? input.quality : undefined;
        const format = input.format && permittedFormats.includes(input.format) ? input.format : undefined;
        return {
            width: matchingPreset.width,
            height: matchingPreset.height,
            mode: matchingPreset.mode,
            quality,
            format,
            fpx: this.options.allowFocalPoint ? input.fpx : undefined,
            fpy: this.options.allowFocalPoint ? input.fpy : undefined,
            preset: input.preset,
        };
    }
}
