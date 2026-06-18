import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    COUNTRY_FRAGMENT,
    CountryFragment,
    createUpdatedTranslatable,
    DataService,
    findTranslation,
    GetCountryDetailDocument,
    getCustomFieldsDefaults,
    LanguageCode,
    NotificationService,
    Permission,
    TypedBaseDetailComponent,
    UpdateCountryInput,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { combineLatest } from 'rxjs';
import { mergeMap, take } from 'rxjs/operators';

export const GET_COUNTRY_DETAIL = gql`
    query GetCountryDetail($id: ID!) {
        country(id: $id) {
            ...Country
        }
    }
    ${COUNTRY_FRAGMENT}
`;

@Component({
    selector: 'vdr-country-detail',
    templateUrl: './country-detail.component.html',
    styleUrls: ['./country-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class CountryDetailComponent
    extends TypedBaseDetailComponent<typeof GetCountryDetailDocument, 'country'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('Region');
    detailForm = this.formBuilder.group({
        code: ['', Validators.required],
        name: ['', Validators.required],
        enabled: [true],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    readonly updatePermission = [Permission.UpdateSettings, Permission.UpdateCountry];

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

    ngOnDestroy(): void {
        this.destroy();
    }

    create() {
        if (!this.detailForm.dirty) {
            return;
        }

        const formValue = this.detailForm.value;
        const input = createUpdatedTranslatable({
            translatable: {
                id: '',
                createdAt: '',
                updatedAt: '',
                code: '',
                name: '',
                enabled: false,
                translations: [],
            } as CountryFragment,
            updatedFields: formValue,
            languageCode: this.languageCode,
            customFieldConfig: this.customFields,
            defaultTranslation: {
                name: formValue.name ?? '',
                languageCode: this.languageCode,
            },
        });
        this.dataService.settings.createCountry(input).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'Country',
                });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createCountry.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'Country',
                });
            },
        );
    }

    save() {
        combineLatest(this.entity$, this.languageCode$)
            .pipe(
                take(1),
                mergeMap(([country, languageCode]) => {
                    const formValue = this.detailForm.value;
                    const input: UpdateCountryInput = createUpdatedTranslatable({
                        translatable: country,
                        updatedFields: formValue,
                        customFieldConfig: this.customFields,
                        languageCode,
                        defaultTranslation: {
                            name: formValue.name ?? '',
                            languageCode,
                        },
                    });
                    return this.dataService.settings.updateCountry(input);
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'Country',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'Country',
                    });
                },
            );
    }

    protected setFormValues(country: CountryFragment, languageCode: LanguageCode): void {
        const currentTranslation = findTranslation(country, languageCode);

        this.detailForm.patchValue({
            code: country.code,
            name: currentTranslation ? currentTranslation.name : '',
            enabled: country.enabled,
        });

        if (this.customFields.length) {
            this.setCustomFieldFormValues(
                this.customFields,
                this.detailForm.get(['customFields']),
                country,
                currentTranslation,
            );
        }
    }
}
