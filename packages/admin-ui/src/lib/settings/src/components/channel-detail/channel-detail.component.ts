import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CHANNEL_FRAGMENT,
    ChannelFragment,
    CreateChannelInput,
    CurrencyCode,
    DataService,
    GetChannelDetailDocument,
    getCustomFieldsDefaults,
    GetSellersQuery,
    LanguageCode,
    NotificationService,
    Permission,
    ServerConfigService,
    TypedBaseDetailComponent,
    UpdateChannelInput,
} from '@vendure/admin-ui/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';
import { map, mergeMap, take, takeUntil } from 'rxjs/operators';

export const GET_CHANNEL_DETAIL = gql`
    query GetChannelDetail($id: ID!) {
        channel(id: $id) {
            ...Channel
        }
    }
    ${CHANNEL_FRAGMENT}
`;

@Component({
    selector: 'vdr-channel-detail',
    templateUrl: './channel-detail.component.html',
    styleUrls: ['./channel-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ChannelDetailComponent
    extends TypedBaseDetailComponent<typeof GetChannelDetailDocument, 'channel'>
    implements OnInit, OnDestroy
{
    DEFAULT_CHANNEL_CODE = DEFAULT_CHANNEL_CODE;
    customFields = this.getCustomFieldConfig('Channel');
    // zones$: Observable<Array<ItemOf<GetZoneListQuery, 'zones'>>>;
    sellers$: Observable<GetSellersQuery['sellers']['items']>;
    detailForm = this.formBuilder.group({
        code: ['', Validators.required],
        token: ['', Validators.required],
        pricesIncludeTax: [false],
        availableLanguageCodes: [[] as string[]],
        availableCurrencyCodes: [[] as string[]],
        defaultCurrencyCode: ['' as CurrencyCode, Validators.required],
        defaultShippingZoneId: ['', Validators.required],
        defaultLanguageCode: [undefined as LanguageCode | undefined, Validators.required],
        defaultTaxZoneId: ['', Validators.required],
        sellerId: ['', Validators.required],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });

    availableLanguageCodes$: Observable<LanguageCode[]>;
    readonly updatePermission = [Permission.SuperAdmin, Permission.UpdateChannel, Permission.CreateChannel];

    constructor(
        protected serverConfigService: ServerConfigService,
        private changeDetector: ChangeDetectorRef,
        protected dataService: DataService,
        private formBuilder: FormBuilder,
        private notificationService: NotificationService,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
        // TODO: make this lazy-loaded autocomplete
        this.sellers$ = this.dataService.settings.getSellerList().mapSingle(data => data.sellers.items);
        this.availableLanguageCodes$ = this.serverConfigService.getAvailableLanguages();
        this.detailForm.controls.availableCurrencyCodes.valueChanges
            .pipe(takeUntil(this.destroy$))
            .subscribe(value => {
                if (value) {
                    const defaultCurrencyCode = this.detailForm.controls.defaultCurrencyCode.value;
                    if (defaultCurrencyCode && !value.includes(defaultCurrencyCode)) {
                        this.detailForm.controls.defaultCurrencyCode.setValue(value[0] as CurrencyCode);
                    }
                }
            });
        this.detailForm.controls.availableLanguageCodes.valueChanges
            .pipe(takeUntil(this.destroy$))
            .subscribe(value => {
                if (value) {
                    const defaultLanguageCode = this.detailForm.controls.defaultLanguageCode.value;
                    if (defaultLanguageCode && !value.includes(defaultLanguageCode)) {
                        this.detailForm.controls.defaultLanguageCode.setValue(value[0] as LanguageCode);
                    }
                }
            });
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
        const {
            code,
            token,
            defaultLanguageCode,
            pricesIncludeTax,
            defaultCurrencyCode,
            defaultShippingZoneId,
            defaultTaxZoneId,
            customFields,
            sellerId,
        } = this.detailForm.value;
        if (
            !code ||
            !token ||
            !defaultLanguageCode ||
            !defaultCurrencyCode ||
            !defaultShippingZoneId ||
            !defaultTaxZoneId
        ) {
            return;
        }
        const input: CreateChannelInput = {
            code,
            token,
            defaultLanguageCode,
            pricesIncludeTax: !!pricesIncludeTax,
            defaultCurrencyCode,
            defaultShippingZoneId,
            defaultTaxZoneId,
            customFields,
            sellerId,
        };
        this.dataService.settings
            .createChannel(input)
            .pipe(
                mergeMap(({ createChannel }) =>
                    this.dataService.auth.currentUser().single$.pipe(
                        map(({ me }) => ({
                            me,
                            createChannel,
                        })),
                    ),
                ),
                mergeMap(({ me, createChannel }) =>
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    this.dataService.client.updateUserChannels(me!.channels).pipe(map(() => createChannel)),
                ),
            )
            .subscribe(data => {
                switch (data.__typename) {
                    case 'Channel':
                        this.notificationService.success(_('common.notify-create-success'), {
                            entity: 'Channel',
                        });
                        this.detailForm.markAsPristine();
                        this.changeDetector.markForCheck();
                        this.router.navigate(['../', data.id], { relativeTo: this.route });
                        break;
                    case 'LanguageNotAvailableError':
                        this.notificationService.error(data.message);
                        break;
                }
            });
    }

    save() {
        if (!this.detailForm.dirty) {
            return;
        }
        const formValue = this.detailForm.value;
        this.entity$
            .pipe(
                take(1),
                mergeMap(channel => {
                    const input = {
                        id: channel.id,
                        code: formValue.code,
                        token: formValue.token,
                        pricesIncludeTax: formValue.pricesIncludeTax,
                        availableLanguageCodes: formValue.availableLanguageCodes,
                        availableCurrencyCodes: formValue.availableCurrencyCodes,
                        defaultCurrencyCode: formValue.defaultCurrencyCode,
                        defaultShippingZoneId: formValue.defaultShippingZoneId,
                        defaultLanguageCode: formValue.defaultLanguageCode,
                        defaultTaxZoneId: formValue.defaultTaxZoneId,
                        customFields: formValue.customFields,
                        sellerId: formValue.sellerId,
                    } as UpdateChannelInput;
                    return this.dataService.settings.updateChannel(input);
                }),
            )
            .subscribe(({ updateChannel }) => {
                switch (updateChannel.__typename) {
                    case 'Channel':
                        this.notificationService.success(_('common.notify-update-success'), {
                            entity: 'Channel',
                        });
                        this.detailForm.markAsPristine();
                        this.changeDetector.markForCheck();
                        break;
                    case 'LanguageNotAvailableError':
                        this.notificationService.error(updateChannel.message);
                }
            });
    }

    /**
     * Update the form values when the entity changes.
     */
    protected setFormValues(entity: ChannelFragment, languageCode: LanguageCode): void {
        this.detailForm.patchValue({
            code: entity.code,
            token: entity.token || this.generateToken(),
            pricesIncludeTax: entity.pricesIncludeTax,
            availableLanguageCodes: entity.availableLanguageCodes,
            availableCurrencyCodes: entity.availableCurrencyCodes,
            defaultCurrencyCode: entity.defaultCurrencyCode,
            defaultShippingZoneId: entity.defaultShippingZone?.id ?? '',
            defaultLanguageCode: entity.defaultLanguageCode,
            defaultTaxZoneId: entity.defaultTaxZone?.id ?? '',
            sellerId: entity.seller?.id ?? '',
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get(['customFields']), entity);
        }
        if (entity.code === DEFAULT_CHANNEL_CODE) {
            const codeControl = this.detailForm.get('code');
            if (codeControl) {
                codeControl.disable();
            }
        }
    }

    private generateToken(): string {
        return Array.from(crypto.getRandomValues(new Uint8Array(10)))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
}
