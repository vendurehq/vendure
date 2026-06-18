import { Pipe, PipeTransform } from '@angular/core';

import { AssetFragment } from '../../common/generated-types';

/**
 * @description
 * Given an Asset object (an object with `preview` and optionally `focalPoint` properties), this pipe
 * returns a string with query parameters designed to work with the image resize capabilities of the
 * AssetServerPlugin.
 *
 * @example
 * ```HTML
 * <img [src]="asset | assetPreview:'tiny'" />
 * <img [src]="asset | assetPreview:150" />
 * ```
 *
 * @docsCategory pipes
 */
@Pipe({
    name: 'assetPreview',
    standalone: false,
})
export class AssetPreviewPipe implements PipeTransform {
    transform(asset?: AssetFragment, preset: string | number = 'thumb'): string {
        if (!asset) {
            return '';
        }
        if (asset.preview == null || typeof asset.preview !== 'string') {
            throw new Error(`Expected an Asset, got ${JSON.stringify(asset)}`);
        }
        const fp = asset.focalPoint ? `&fpx=${asset.focalPoint.x}&fpy=${asset.focalPoint.y}` : '';
        if (Number.isNaN(Number(preset))) {
            return `${asset.preview}?preset=${preset}${fp}`;
        } else {
            return `${asset.preview}?w=${preset}&h=${preset}${fp}`;
        }
    }
}
