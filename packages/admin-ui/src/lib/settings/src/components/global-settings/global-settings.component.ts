import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    getCustomFieldsDefaults,
    GetGlobalSettingsDetailDocument,
    GlobalSettings,
    LanguageCode,
    NotificationService,
    Permission,
    TypedBaseDetailComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { switchMap, tap, withLatestFrom } from 'rxjs/operators';

export const GET_GLOBAL_SETTINGS_DETAIL = gql`
    query GetGlobalSettingsDetail {
        globalSettings {
            ...GlobalSettingsDetail
        }
    }
    fragment GlobalSettingsDetail on GlobalSettings {
        id
        createdAt
        updatedAt
        availableLanguages
        trackInventory
        outOfStockThreshold
    }
`;

@Component({
    selector: 'vdr-global-settings',
    templateUrl: './global-settings.component.html',
    styleUrls: ['./global-settings.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class GlobalSettingsComponent
    extends TypedBaseDetailComponent<typeof GetGlobalSettingsDetailDocument, 'globalSettings'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('GlobalSettings');
    detailForm = this.formBuilder.group({
        availableLanguages: [[] as LanguageCode[]],
        trackInventory: false,
        outOfStockThreshold: [0, Validators.required],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    languageCodes = Object.values(LanguageCode);
    readonly updatePermission = [Permission.UpdateSettings, Permission.UpdateGlobalSettings];

    constructor(
        private changeDetector: ChangeDetectorRef,
        protected dataService: DataService,
        private formBuilder: FormBuilder,
        private notificationService: NotificationService,
    ) {
        super();
    }

    ngOnInit(): void {
        this.init();
        this.dataService.client.userStatus().single$.subscribe(({ userStatus }) => {
            if (!userStatus.permissions.includes(Permission.UpdateSettings)) {
                const languagesSelect = this.detailForm.get('availableLanguages');
                if (languagesSelect) {
                    languagesSelect.disable();
                }
            }
        });
    }

    ngOnDestroy() {
        this.destroy();
    }

    save() {
        if (!this.detailForm.dirty) {
            return;
        }

        this.dataService.settings
            .updateGlobalSettings(this.detailForm.value)
            .pipe(
                tap(({ updateGlobalSettings }) => {
                    switch (updateGlobalSettings.__typename) {
                        case 'GlobalSettings':
                            this.detailForm.markAsPristine();
                            this.changeDetector.markForCheck();
                            this.notificationService.success(_('common.notify-update-success'), {
                                entity: 'Settings',
                            });
                            break;
                        case 'ChannelDefaultLanguageError':
                            this.notificationService.error(updateGlobalSettings.message);
                    }
                }),
                switchMap(() => this.serverConfigService.refreshGlobalSettings()),
                withLatestFrom(this.dataService.client.uiState().single$),
            )
            .subscribe(([{ globalSettings }, { uiState }]) => {
                const availableLangs = globalSettings.availableLanguages;
                if (availableLangs.length && !availableLangs.includes(uiState.contentLanguage)) {
                    this.dataService.client.setContentLanguage(availableLangs[0]).subscribe();
                }
            });
    }

    protected setFormValues(entity: GlobalSettings, languageCode: LanguageCode): void {
        this.detailForm.patchValue({
            availableLanguages: entity.availableLanguages,
            trackInventory: entity.trackInventory,
            outOfStockThreshold: entity.outOfStockThreshold,
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get('customFields'), entity);
        }
    }
}
