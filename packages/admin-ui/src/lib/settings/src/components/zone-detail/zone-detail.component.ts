import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CreateZoneInput,
    DataService,
    getCustomFieldsDefaults,
    GetZoneDetailDocument,
    GetZoneDetailQuery,
    LanguageCode,
    NotificationService,
    Permission,
    TypedBaseDetailComponent,
    UpdateTaxCategoryInput,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { mergeMap, take } from 'rxjs/operators';

export const GET_ZONE_DETAIL = gql`
    query GetZoneDetail($id: ID!) {
        zone(id: $id) {
            ...ZoneDetail
        }
    }
    fragment ZoneDetail on Zone {
        id
        createdAt
        updatedAt
        name
    }
`;

@Component({
    selector: 'vdr-zone-detail',
    templateUrl: './zone-detail.component.html',
    styleUrls: ['./zone-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ZoneDetailComponent
    extends TypedBaseDetailComponent<typeof GetZoneDetailDocument, 'zone'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('Zone');
    detailForm = this.formBuilder.group({
        name: ['', Validators.required],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    readonly updatePermission = [Permission.UpdateSettings, Permission.UpdateZone];

    constructor(
        private changeDetector: ChangeDetectorRef,
        protected dataService: DataService,
        private formBuilder: FormBuilder,
        private notificationService: NotificationService,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
    }

    ngOnDestroy() {
        this.destroy();
    }

    saveButtonEnabled(): boolean {
        return this.detailForm.dirty && this.detailForm.valid;
    }

    create() {
        if (!this.detailForm.dirty) {
            return;
        }
        const { name, customFields } = this.detailForm.value;
        if (!name) {
            return;
        }
        const input = {
            name,
            customFields,
        } satisfies CreateZoneInput;
        this.dataService.settings.createZone(input).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'Zone',
                });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createZone.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'Zone',
                });
            },
        );
    }

    save() {
        if (!this.detailForm.dirty) {
            return;
        }
        const formValue = this.detailForm.value;
        this.entity$
            .pipe(
                take(1),
                mergeMap(zone => {
                    const input = {
                        id: zone.id,
                        name: formValue.name,
                        customFields: formValue.customFields,
                    } satisfies UpdateTaxCategoryInput;
                    return this.dataService.settings.updateZone(input);
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'Zone',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'Zone',
                    });
                },
            );
    }

    /**
     * Update the form values when the entity changes.
     */
    protected setFormValues(
        entity: NonNullable<GetZoneDetailQuery['zone']>,
        languageCode: LanguageCode,
    ): void {
        this.detailForm.patchValue({
            name: entity.name,
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get('customFields'), entity);
        }
    }
}
