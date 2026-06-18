import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { gql } from 'apollo-angular';
import { Observable, of } from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';
import { GetAssetQuery, RelationCustomFieldConfig } from '../../../../common/generated-types';
import { ASSET_FRAGMENT, TAG_FRAGMENT } from '../../../../data/definitions/product-definitions';
import { DataService } from '../../../../data/providers/data.service';
import { ModalService } from '../../../../providers/modal/modal.service';
import { AssetPickerDialogComponent } from '../../../components/asset-picker-dialog/asset-picker-dialog.component';
import { AssetPreviewDialogComponent } from '../../../components/asset-preview-dialog/asset-preview-dialog.component';

export const RELATION_ASSET_INPUT_QUERY = gql`
    query RelationAssetInputQuery($id: ID!) {
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
    selector: 'vdr-relation-asset-input',
    templateUrl: './relation-asset-input.component.html',
    styleUrls: ['./relation-asset-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class RelationAssetInputComponent implements OnInit {
    @Input() readonly: boolean;
    @Input('parentFormControl') formControl: UntypedFormControl;
    @Input() config: RelationCustomFieldConfig;
    asset$: Observable<GetAssetQuery['asset'] | undefined>;

    constructor(
        private modalService: ModalService,
        private dataService: DataService,
    ) {}

    ngOnInit() {
        this.asset$ = this.formControl.valueChanges.pipe(
            startWith(this.formControl.value),
            map(asset => asset?.id),
            distinctUntilChanged(),
            switchMap(id => {
                if (id) {
                    return this.dataService.product.getAsset(id).mapStream(data => data.asset || undefined);
                } else {
                    return of(undefined);
                }
            }),
        );
    }

    selectAsset() {
        this.modalService
            .fromComponent(AssetPickerDialogComponent, {
                size: 'xl',
                locals: {
                    multiSelect: false,
                },
            })
            .subscribe(result => {
                if (result && result.length) {
                    this.formControl.setValue(result[0]);
                    this.formControl.markAsDirty();
                }
            });
    }

    remove() {
        this.formControl.setValue(null);
        this.formControl.markAsDirty();
    }

    previewAsset(asset: NonNullable<GetAssetQuery['asset']>) {
        this.modalService
            .fromComponent(AssetPreviewDialogComponent, {
                size: 'xl',
                closable: true,
                locals: { asset },
            })
            .subscribe();
    }
}
