import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    EventEmitter,
    HostBinding,
    Input,
    Output,
} from '@angular/core';
import { unique } from '@vendure/common/lib/unique';
import { Asset, Permission } from '../../../common/generated-types';
import { ModalService } from '../../../providers/modal/modal.service';
import { AssetPickerDialogComponent } from '../asset-picker-dialog/asset-picker-dialog.component';
import { AssetPreviewDialogComponent } from '../asset-preview-dialog/asset-preview-dialog.component';

export interface AssetChange {
    assets: Asset[];
    featuredAsset: Asset | undefined;
}

/**
 * A component which displays the Assets, and allows assets to be removed and
 * added, and for the featured asset to be set.
 *
 * Note: rather complex code for drag drop is due to a limitation of the default CDK implementation
 * which is addressed by a work-around from here: https://github.com/angular/components/issues/13372#issuecomment-483998378
 */
@Component({
    selector: 'vdr-assets',
    templateUrl: './assets.component.html',
    styleUrls: ['./assets.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AssetsComponent {
    @Input('assets') set assetsSetter(val: Asset[]) {
        // create a new non-readonly array of assets
        this.assets = (val || []).slice();
    }

    @Input() featuredAsset: Asset | undefined;
    @HostBinding('class.compact')
    @Input()
    compact = false;
    // eslint-disable-next-line @angular-eslint/no-output-native
    @Output() change = new EventEmitter<AssetChange>();

    public assets: Asset[] = [];

    @Input()
    updatePermissions: string | string[] | Permission | Permission[];

    @Input() multiSelect = true;

    constructor(
        private modalService: ModalService,
        private changeDetector: ChangeDetectorRef,
    ) {}

    selectAssets() {
        this.modalService
            .fromComponent(AssetPickerDialogComponent, {
                size: 'xl',
                locals: {
                    multiSelect: this.multiSelect,
                },
            })
            .subscribe(result => {
                if (result && result.length) {
                    this.assets = this.multiSelect ? unique(this.assets.concat(result), 'id') : result;
                    if (!this.featuredAsset || !this.multiSelect) {
                        this.featuredAsset = result[0];
                    }
                    this.emitChangeEvent(this.assets, this.featuredAsset);
                    this.changeDetector.markForCheck();
                }
            });
    }

    setAsFeatured(asset: Asset) {
        this.featuredAsset = asset;
        this.emitChangeEvent(this.assets, asset);
    }

    isFeatured(asset: Asset): boolean {
        return !!this.featuredAsset && this.featuredAsset.id === asset.id;
    }

    previewAsset(asset: Asset) {
        this.modalService
            .fromComponent(AssetPreviewDialogComponent, {
                size: 'xl',
                closable: true,
                locals: { asset, assets: this.assets },
            })
            .subscribe();
    }

    removeAsset(asset: Asset) {
        this.assets = this.assets.filter(a => a.id !== asset.id);
        if (this.featuredAsset && this.featuredAsset.id === asset.id) {
            this.featuredAsset = this.assets.length > 0 ? this.assets[0] : undefined;
        }
        this.emitChangeEvent(this.assets, this.featuredAsset);
    }

    private emitChangeEvent(assets: Asset[], featuredAsset: Asset | undefined) {
        this.change.emit({
            assets,
            featuredAsset,
        });
    }

    dropListDropped(event: CdkDragDrop<number>) {
        moveItemInArray(this.assets, event.previousContainer.data, event.container.data);
        this.emitChangeEvent(this.assets, this.featuredAsset);
    }
}
