import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CreateRoleInput,
    DataService,
    GetRoleDetailDocument,
    LanguageCode,
    NotificationService,
    Permission,
    Role,
    ROLE_FRAGMENT,
    TypedBaseDetailComponent,
    UpdateRoleInput,
} from '@vendure/admin-ui/core';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { unique } from '@vendure/common/lib/unique';
import { gql } from 'apollo-angular';
import { mergeMap, take } from 'rxjs/operators';

export const GET_ROLE_DETAIL = gql`
    query GetRoleDetail($id: ID!) {
        role(id: $id) {
            ...Role
        }
    }
    ${ROLE_FRAGMENT}
`;

@Component({
    selector: 'vdr-role-detail',
    templateUrl: './role-detail.component.html',
    styleUrls: ['./role-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class RoleDetailComponent
    extends TypedBaseDetailComponent<typeof GetRoleDetailDocument, 'role'>
    implements OnInit, OnDestroy
{
    detailForm = this.formBuilder.group({
        code: ['', Validators.required],
        description: ['', Validators.required],
        channelIds: [[] as string[]],
        permissions: [[] as Permission[]],
    });
    permissionDefinitions = this.serverConfigService.getPermissionDefinitions();
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

    updateCode(nameValue: string) {
        const codeControl = this.detailForm.get(['code']);
        if (codeControl && codeControl.pristine) {
            codeControl.setValue(normalizeString(nameValue, '-'));
        }
    }

    setPermission(change: { permission: string; value: boolean }) {
        const permissionsControl = this.detailForm.get('permissions');
        if (permissionsControl) {
            const currentPermissions = permissionsControl.value as string[];
            const newValue = (
                change.value === true
                    ? unique([...currentPermissions, change.permission])
                    : currentPermissions.filter(p => p !== change.permission)
            ) as Permission[];
            permissionsControl.setValue(newValue);
            permissionsControl.markAsDirty();
        }
    }

    create() {
        const { code, description, permissions, channelIds } = this.detailForm.value;
        if (!code || !description) {
            return;
        }
        const role: CreateRoleInput = {
            code,
            description,
            permissions: permissions ?? [],
            channelIds,
        };
        this.dataService.administrator.createRole(role).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), { entity: 'Role' });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createRole.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'Role',
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
                    const role: UpdateRoleInput = { id, ...formValue };
                    return this.dataService.administrator.updateRole(role);
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), { entity: 'Role' });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'Role',
                    });
                },
            );
    }

    protected setFormValues(role: Role, languageCode: LanguageCode): void {
        this.detailForm.patchValue({
            description: role.description,
            code: role.code,
            channelIds: role.channels.map(c => c.id),
            permissions: role.permissions,
        });
        // This was required to get the channel selector component to
        // correctly display its contents. A while spent debugging the root
        // cause did not yield a solution, therefore this next line.
        this.changeDetector.detectChanges();
    }
}
