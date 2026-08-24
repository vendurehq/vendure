import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { ResultOf } from '@graphql-typed-document-node/core';
import {
    ADMINISTRATOR_FRAGMENT,
    CreateAdministratorInput,
    DataService,
    GetAdministratorDetailDocument,
    getCustomFieldsDefaults,
    LanguageCode,
    NotificationService,
    Permission,
    PermissionDefinition,
    RoleFragment,
    TypedBaseDetailComponent,
    UpdateAdministratorInput,
} from '@vendure/admin-ui/core';
import { CUSTOMER_ROLE_CODE } from '@vendure/common/lib/shared-constants';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';
import { mergeMap, take, takeUntil } from 'rxjs/operators';

export const GET_ADMINISTRATOR_DETAIL = gql`
    query GetAdministratorDetail($id: ID!) {
        administrator(id: $id) {
            ...Administrator
        }
    }
    ${ADMINISTRATOR_FRAGMENT}
`;

@Component({
    selector: 'vdr-admin-detail',
    templateUrl: './admin-detail.component.html',
    styleUrls: ['./admin-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AdminDetailComponent
    extends TypedBaseDetailComponent<typeof GetAdministratorDetailDocument, 'administrator'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('Administrator');
    detailForm = this.formBuilder.group({
        emailAddress: ['', Validators.required],
        firstName: ['', Validators.required],
        lastName: ['', Validators.required],
        password: [''],
        roles: [
            [] as NonNullable<
                ResultOf<typeof GetAdministratorDetailDocument>['administrator']
            >['user']['roles'],
        ],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    permissionDefinitions: PermissionDefinition[];
    allRoles$: Observable<RoleFragment[]>;
    selectedRoles: RoleFragment[] = [];
    selectedRolePermissions: Permission[] = [];
    private activeChannelId: string;

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
        this.allRoles$ = this.dataService.administrator
            .getRoles(999)
            .mapStream(item => item.roles.items.filter(i => i.code !== CUSTOMER_ROLE_CODE));
        this.dataService.client.userStatus().single$.subscribe(({ userStatus }) => {
            if (
                !userStatus.permissions.includes(Permission.CreateAdministrator) &&
                !userStatus.permissions.includes(Permission.UpdateAdministrator)
            ) {
                const rolesSelect = this.detailForm.get('roles');
                if (rolesSelect) {
                    rolesSelect.disable();
                }
            }
        });
        // The role select edits the User's Roles on the active Channel: on save, its value
        // is written as RoleAssignments pinned to the active Channel.
        this.dataService.client
            .userStatus()
            .mapStream(({ userStatus }) => userStatus.activeChannelId)
            .pipe(takeUntil(this.destroy$))
            .subscribe(activeChannelId => {
                if (activeChannelId) {
                    this.activeChannelId = activeChannelId;
                }
            });
        this.permissionDefinitions = this.serverConfigService.getPermissionDefinitions();
    }

    ngOnDestroy(): void {
        this.destroy();
    }

    rolesChanged(roles: RoleFragment[]) {
        this.buildPermissionsMap();
    }

    create() {
        const { emailAddress, firstName, lastName, password, customFields, roles } = this.detailForm.value;
        if (!emailAddress || !firstName || !lastName || !password) {
            return;
        }
        const administrator: CreateAdministratorInput = {
            emailAddress,
            firstName,
            lastName,
            password,
            customFields,
            // The selected Roles are granted on the active Channel.
            roleAssignments:
                roles
                    ?.map(role => role.id)
                    .filter(notNullOrUndefined)
                    .map(roleId => ({ roleId, channelId: this.activeChannelId })) ?? [],
        };
        this.dataService.administrator.createAdministrator(administrator).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'Administrator',
                });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createAdministrator.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'Administrator',
                });
            },
        );
    }

    save() {
        this.entity$
            .pipe(
                take(1),
                mergeMap(({ id, user }) => {
                    const formValue = this.detailForm.value;
                    // roleAssignments is a full replace-set across all Channels, but this
                    // editor only manages the Roles on the active Channel: keep the User's
                    // assignments on other Channels and replace the active Channel's set
                    // with the form selection.
                    const roleAssignments = [
                        ...user.roleAssignments
                            .filter(assignment => assignment.channelId !== this.activeChannelId)
                            .map(({ roleId, channelId }) => ({ roleId, channelId })),
                        ...(formValue.roles ?? [])
                            .map(role => role.id)
                            .filter(notNullOrUndefined)
                            .map(roleId => ({ roleId, channelId: this.activeChannelId })),
                    ];
                    const administrator: UpdateAdministratorInput = {
                        id,
                        emailAddress: formValue.emailAddress,
                        firstName: formValue.firstName,
                        lastName: formValue.lastName,
                        password: formValue.password,
                        customFields: formValue.customFields,
                        roleAssignments,
                    };
                    return this.dataService.administrator.updateAdministrator(administrator);
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

    protected setFormValues(
        entity: NonNullable<ResultOf<typeof GetAdministratorDetailDocument>['administrator']>,
        languageCode: LanguageCode,
    ) {
        this.detailForm.patchValue({
            emailAddress: entity.emailAddress,
            firstName: entity.firstName,
            lastName: entity.lastName,
            roles: entity.user.roles,
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get(['customFields']), entity);
        }
        const passwordControl = this.detailForm.get('password');
        if (passwordControl) {
            if (!entity.id) {
                passwordControl.setValidators([Validators.required]);
            } else {
                passwordControl.setValidators([]);
            }
        }
        this.buildPermissionsMap();
    }

    private buildPermissionsMap() {
        // A Role is a channel-agnostic template: the Channels its permissions apply to are
        // determined per-user by RoleAssignments, so the display is a single union of the
        // selected Roles' permissions.
        const rolesControl = this.detailForm.get('roles');
        if (rolesControl) {
            const roles = rolesControl.value ?? [];
            const permissionSet = new Set<Permission>();
            for (const role of roles) {
                role.permissions.forEach(p => permissionSet.add(p as Permission));
            }
            this.selectedRolePermissions = Array.from(permissionSet);
        }
    }
}
