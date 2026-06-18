import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    Administrator,
    DataService,
    getCustomFieldsDefaults,
    GetProfileDetailDocument,
    LanguageCode,
    NotificationService,
    TypedBaseDetailComponent,
    UpdateActiveAdministratorInput,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { mergeMap, take } from 'rxjs/operators';

export const GET_PROFILE_DETAIL = gql`
    query GetProfileDetail {
        activeAdministrator {
            ...ProfileDetail
        }
    }
    fragment ProfileDetail on Administrator {
        id
        createdAt
        updatedAt
        firstName
        lastName
        emailAddress
        user {
            id
            lastLogin
            verified
        }
    }
`;

@Component({
    selector: 'vdr-profile',
    templateUrl: './profile.component.html',
    styleUrls: ['./profile.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ProfileComponent
    extends TypedBaseDetailComponent<typeof GetProfileDetailDocument, 'activeAdministrator'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('Administrator');
    detailForm = this.formBuilder.group({
        emailAddress: ['', Validators.required],
        firstName: ['', Validators.required],
        lastName: ['', Validators.required],
        password: [''],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });

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

    save() {
        this.entity$
            .pipe(
                take(1),
                mergeMap(({ id }) => {
                    const formValue = this.detailForm.value;
                    const administrator: UpdateActiveAdministratorInput = {
                        emailAddress: formValue.emailAddress,
                        firstName: formValue.firstName,
                        lastName: formValue.lastName,
                        password: formValue.password,
                        customFields: formValue.customFields,
                    };
                    return this.dataService.administrator.updateActiveAdministrator(administrator);
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'Administrator',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'Administrator',
                    });
                },
            );
    }

    protected setFormValues(administrator: Administrator, languageCode: LanguageCode): void {
        this.detailForm.patchValue({
            emailAddress: administrator.emailAddress,
            firstName: administrator.firstName,
            lastName: administrator.lastName,
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(
                this.customFields,
                this.detailForm.get('customFields'),
                administrator,
            );
        }
    }
}
