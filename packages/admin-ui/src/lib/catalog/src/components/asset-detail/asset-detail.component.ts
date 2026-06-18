import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, FormGroup, UntypedFormBuilder } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    ASSET_FRAGMENT,
    AssetDetailQueryDocument,
    AssetDetailQueryQuery,
    DataService,
    getCustomFieldsDefaults,
    LanguageCode,
    NotificationService,
    TAG_FRAGMENT,
    TypedBaseDetailComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const ASSET_DETAIL_QUERY = gql`
    query AssetDetailQuery($id: ID!) {
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
    selector: 'vdr-asset-detail',
    templateUrl: './asset-detail.component.html',
    styleUrls: ['./asset-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class AssetDetailComponent
    extends TypedBaseDetailComponent<typeof AssetDetailQueryDocument, 'asset'>
    implements OnInit, OnDestroy
{
    readonly customFields = this.getCustomFieldConfig('Asset');
    detailForm = new FormGroup({
        name: new FormControl(''),
        tags: new FormControl([] as string[]),
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });

    constructor(
        private notificationService: NotificationService,
        protected dataService: DataService,
        private formBuilder: UntypedFormBuilder,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
    }

    ngOnDestroy() {
        this.destroy();
    }

    onAssetChange(event: { id: string; name: string; tags: string[] }) {
        this.detailForm.get('name')?.setValue(event.name);
        this.detailForm.get('tags')?.setValue(event.tags);
        this.detailForm.markAsDirty();
    }

    save() {
        this.dataService.product
            .updateAsset({
                id: this.id,
                name: this.detailForm.value.name,
                tags: this.detailForm.value.tags,
                customFields: this.detailForm.value.customFields,
            })
            .subscribe(
                () => {
                    this.notificationService.success(_('common.notify-update-success'), { entity: 'Asset' });
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'Asset',
                    });
                },
            );
    }

    protected setFormValues(
        entity: NonNullable<AssetDetailQueryQuery['asset']>,
        languageCode: LanguageCode,
    ): void {
        this.detailForm.get('name')?.setValue(entity.name);
        this.detailForm.get('tags')?.setValue(entity.tags.map(t => t.id));
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get(['customFields']), entity);
        }
    }
}
