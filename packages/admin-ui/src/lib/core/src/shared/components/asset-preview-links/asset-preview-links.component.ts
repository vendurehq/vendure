import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { AssetLike } from '../asset-gallery/asset-gallery.types';

export const ASSET_SIZES = ['tiny', 'thumb', 'small', 'medium', 'large', 'full'];

@Component({
    selector: 'vdr-asset-preview-links',
    templateUrl: './asset-preview-links.component.html',
    styleUrls: ['./asset-preview-links.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AssetPreviewLinksComponent {
    @Input() asset: AssetLike;
    sizes = ASSET_SIZES;
}
