import { Stream } from 'stream';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * The AssetPreviewStrategy determines how preview images for assets are created. For image
 * assets, this would usually typically involve resizing to sensible dimensions. Other file types
 * could be previewed in a variety of ways, e.g.:
 *
 * - waveform images generated for audio files
 * - preview images generated for pdf documents
 * - watermarks added to preview images
 *
 * :::info
 *
 * This is configured via the `assetOptions.assetPreviewStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory assets
 */
export interface AssetPreviewStrategy extends InjectableStrategy {
    generatePreviewImage(ctx: RequestContext, mimeType: string, data: Buffer): Promise<Buffer>;
}
