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
import { mergeMap, take } from 'rxjs/operators';

export interface PermissionsByChannel {
    channelId: string;
    channelCode: string;
    permissions: { [K in Permission]: boolean };
}

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
    standalone: false
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
    selectedRolePermissions: { [channelId: string]: PermissionsByChannel } = {} as any;
    selectedChannelId: string | null = null;

    getAvailableChannels(): PermissionsByChannel[] {
        return Object.values(this.selectedRolePermissions);
    }

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
        this.permissionDefinitions = this.serverConfigService.getPermissionDefinitions();
    }

    ngOnDestroy(): void {
        this.destroy();
    }

    rolesChanged(roles: RoleFragment[]) {
        this.buildPermissionsMap();
    }

    getPermissionsForSelectedChannel(): string[] {
        function getActivePermissions(input: PermissionsByChannel['permissions']): string[] {
            return Object.entries(input)
                .filter(([permission, active]) => active)
                .map(([permission, active]) => permission);
        }
        if (this.selectedChannelId) {
            const selectedChannel = this.selectedRolePermissions[this.selectedChannelId];
            if (selectedChannel) {
                const permissionMap = this.selectedRolePermissions[this.selectedChannelId].permissions;
                return getActivePermissions(permissionMap);
            }
        }
        const channels = Object.values(this.selectedRolePermissions);
        if (0 < channels.length) {
            this.selectedChannelId = channels[0].channelId;
            return getActivePermissions(channels[0].permissions);
        }
        return [];
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
            roleIds: roles?.map(role => role.id).filter(notNullOrUndefined) ?? [],
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
                mergeMap(({ id }) => {
                    const formValue = this.detailForm.value;
                    const administrator: UpdateAdministratorInput = {
                        id,
                        emailAddress: formValue.emailAddress,
                        firstName: formValue.firstName,
                        lastName: formValue.lastName,
                        password: formValue.password,
                        customFields: formValue.customFields,
                        roleIds: formValue.roles?.map(role => role.id),
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
        const permissionsControl = this.detailForm.get('roles');
        if (permissionsControl) {
            const roles = permissionsControl.value;
            const channelIdPermissionsMap = new Map<string, Set<Permission>>();
            const channelIdCodeMap = new Map<string, string>();

            for (const role of roles ?? []) {
                for (const channel of role.channels) {
                    const channelPermissions = channelIdPermissionsMap.get(channel.id);
                    const permissionSet = channelPermissions || new Set<Permission>();

                    role.permissions.forEach(p => permissionSet.add(p));
                    channelIdPermissionsMap.set(channel.id, permissionSet);
                    channelIdCodeMap.set(channel.id, channel.code);
                }
            }

            this.selectedRolePermissions = {} as any;
            for (const channelId of Array.from(channelIdPermissionsMap.keys())) {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const permissionSet = channelIdPermissionsMap.get(channelId)!;
                const permissionsHash: { [K in Permission]: boolean } = {} as any;
                for (const def of this.serverConfigService.getPermissionDefinitions()) {
                    permissionsHash[def.name] = permissionSet.has(def.name as Permission);
                }
                this.selectedRolePermissions[channelId] = {
                    /* eslint-disable @typescript-eslint/no-non-null-assertion */
                    channelId,
                    channelCode: channelIdCodeMap.get(channelId)!,
                    permissions: permissionsHash,
                    /* eslint-enable @typescript-eslint/no-non-null-assertion */
                };
            }
        }
    }
}
