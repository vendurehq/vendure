import { ChangeDetectorRef, Directive, Input, TemplateRef, ViewContainerRef } from '@angular/core';
import { of } from 'rxjs';
import { map, tap } from 'rxjs/operators';

import { Permission } from '../../common/generated-types';
import { PermissionsService } from '../../providers/permissions/permissions.service';

import { IfDirectiveBase } from './if-directive-base';

/**
 * @description
 * Conditionally shows/hides templates based on the current active user having the specified permission.
 * Based on the ngIf source. Also support "else" templates:
 *
 * @example
 * ```html
 * <button *vdrIfPermissions="'DeleteCatalog'; else unauthorized">Delete Product</button>
 * <ng-template #unauthorized>Not allowed!</ng-template>
 * ```
 *
 * The permission can be a single string, or an array. If an array is passed, then _all_ of the permissions
 * must match (logical AND)
 *
 * @docsCategory directives
 */
@Directive({
    selector: '[vdrIfPermissions]',
    standalone: false,
})
export class IfPermissionsDirective extends IfDirectiveBase<Array<Permission[] | null>> {
    private permissionToCheck: string[] | null = ['__initial_value__'];

    constructor(
        _viewContainer: ViewContainerRef,
        templateRef: TemplateRef<any>,
        private changeDetectorRef: ChangeDetectorRef,
        private permissionsService: PermissionsService,
    ) {
        super(_viewContainer, templateRef, permissions => {
            if (permissions == null) {
                return of(true);
            } else if (!permissions) {
                return of(false);
            }
            return this.permissionsService.currentUserPermissions$.pipe(
                map(() => this.permissionsService.userHasPermissions(permissions)),
                tap(() => this.changeDetectorRef.markForCheck()),
            );
        });
    }

    /**
     * The permission to check to determine whether to show the template.
     */
    @Input()
    set vdrIfPermissions(permission: string | string[] | null) {
        this.permissionToCheck =
            (permission && (Array.isArray(permission) ? permission : [permission])) || null;
        this.updateArgs$.next([this.permissionToCheck as Permission[]]);
    }

    /**
     * A template to show if the current user does not have the specified permission.
     */
    @Input()
    set vdrIfPermissionsElse(templateRef: TemplateRef<any> | null) {
        this.setElseTemplate(templateRef);
        this.updateArgs$.next([this.permissionToCheck as Permission[]]);
    }
}
