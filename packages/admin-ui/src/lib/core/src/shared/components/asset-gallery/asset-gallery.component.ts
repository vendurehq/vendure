import {
    ChangeDetectionStrategy,
    Component,
    EventEmitter,
    Input,
    OnChanges,
    Output,
    SimpleChanges,
} from '@angular/core';

import { SelectionManager } from '../../../common/utilities/selection-manager';
import { ModalService } from '../../../providers/modal/modal.service';
import { AssetPreviewDialogComponent } from '../asset-preview-dialog/asset-preview-dialog.component';

import { AssetLike } from './asset-gallery.types';

@Component({
    selector: 'vdr-asset-gallery',
    templateUrl: './asset-gallery.component.html',
    styleUrls: ['./asset-gallery.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AssetGalleryComponent implements OnChanges {
    @Input() assets: AssetLike[];
    /**
     * If true, allows multiple assets to be selected by ctrl+clicking.
     */
    @Input() multiSelect = false;
    @Input() canDelete = false;
    @Output() selectionChange = new EventEmitter<AssetLike[]>();
    @Output() deleteAssets = new EventEmitter<AssetLike[]>();
    @Output() editAssetClick = new EventEmitter<void>();

    selectionManager = new SelectionManager<AssetLike>({
        multiSelect: this.multiSelect,
        itemsAreEqual: (a, b) => a.id === b.id,
        additiveMode: false,
    });

    constructor(private modalService: ModalService) {}

    ngOnChanges(changes: SimpleChanges) {
        if (this.assets) {
            for (const asset of this.selectionManager.selection) {
                // Update any selected assets with any changes
                const match = this.assets.find(a => a.id === asset.id);
                if (match) {
                    Object.assign(asset, match);
                }
            }
        }
        if (changes['assets']) {
            this.selectionManager.setCurrentItems(this.assets);
        }
        if (changes['multiSelect']) {
            this.selectionManager.setMultiSelect(this.multiSelect);
        }
    }

    toggleSelection(asset: AssetLike, event?: MouseEvent) {
        this.selectionManager.toggleSelection(asset, event);
        this.selectionChange.emit(this.selectionManager.selection);
    }

    selectMultiple(assets: AssetLike[]) {
        this.selectionManager.selectMultiple(assets);
        this.selectionChange.emit(this.selectionManager.selection);
    }

    isSelected(asset: AssetLike): boolean {
        return this.selectionManager.isSelected(asset);
    }

    lastSelected(): AssetLike {
        return this.selectionManager.lastSelected();
    }

    previewAsset(asset: AssetLike) {
        this.modalService
            .fromComponent(AssetPreviewDialogComponent, {
                size: 'xl',
                closable: true,
                locals: { asset, assets: this.assets },
            })
            .subscribe();
    }

    entityInfoClick(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
    }
}
