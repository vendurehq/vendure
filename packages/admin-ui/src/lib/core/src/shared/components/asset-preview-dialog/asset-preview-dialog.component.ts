import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { gql } from 'apollo-angular';
import { Observable, of } from 'rxjs';
import { map, mergeMap, tap } from 'rxjs/operators';

import { GetAssetQuery, UpdateAssetInput } from '../../../common/generated-types';
import { ASSET_FRAGMENT, TAG_FRAGMENT } from '../../../data/definitions/product-definitions';
import { DataService } from '../../../data/providers/data.service';
import { Dialog } from '../../../providers/modal/modal.types';
import { AssetLike } from '../asset-gallery/asset-gallery.types';

export const ASSET_PREVIEW_QUERY = gql`
    query AssetPreviewQuery($id: ID!) {
        asset(id: $id) {
            ...Asset
            tags {
                ...Tag
            }
        }
    }
    ${ASSET_FRAGMENT}
    ${TAG_FRAGMENT}
`;

@Component({
    selector: 'vdr-asset-preview-dialog',
    templateUrl: './asset-preview-dialog.component.html',
    styleUrls: ['./asset-preview-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AssetPreviewDialogComponent implements Dialog<void>, OnInit {
    constructor(private dataService: DataService) {}
    asset: AssetLike;
    assets?: AssetLike[];
    assetChanges?: UpdateAssetInput;
    resolveWith: (result?: void) => void;
    assetWithTags$: Observable<GetAssetQuery['asset']>;
    assetsWithTags$: Observable<Array<GetAssetQuery['asset']>>;

    ngOnInit() {
        this.assetWithTags$ = of(this.asset).pipe(
            mergeMap(asset => {
                if (this.hasTags(asset)) {
                    return of(asset);
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    return this.dataService.product.getAsset(asset.id).mapSingle(data => data.asset!);
                }
            }),
        );

        this.assetsWithTags$ = of(this.assets ?? []);
    }

    private hasTags(asset: AssetLike): asset is AssetLike & { tags: string[] } {
        return asset.hasOwnProperty('tags');
    }
}
