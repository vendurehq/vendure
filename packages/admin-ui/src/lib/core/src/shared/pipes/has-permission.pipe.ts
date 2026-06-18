import { ChangeDetectorRef, OnDestroy, Pipe, PipeTransform } from '@angular/core';
import { Subscription } from 'rxjs';
import { PermissionsService } from '../../providers/permissions/permissions.service';

/**
 * @description
 * A pipe which checks the provided permission against all the permissions of the current user.
 * Returns `true` if the current user has that permission.
 *
 * @example
 * ```HTML
 * <button [disabled]="!('UpdateCatalog' | hasPermission)">Save Changes</button>
 * ```
 * @docsCategory pipes
 */
@Pipe({
    name: 'hasPermission',
    pure: false,
    standalone: false,
})
export class HasPermissionPipe implements PipeTransform, OnDestroy {
    private hasPermission = false;
    private lastPermissions: string | null = null;
    private subscription: Subscription;

    constructor(
        private permissionsService: PermissionsService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {}

    transform(input: string | string[]): any {
        const requiredPermissions = Array.isArray(input) ? input : [input];
        const requiredPermissionsString = requiredPermissions.join(',');
        if (this.lastPermissions !== requiredPermissionsString) {
            this.lastPermissions = requiredPermissionsString;
            this.hasPermission = false;
            this.dispose();
            this.subscription = this.permissionsService.currentUserPermissions$.subscribe(() => {
                this.hasPermission = this.permissionsService.userHasPermissions(requiredPermissions);
                this.changeDetectorRef.markForCheck();
            });
        }

        return this.hasPermission;
    }

    ngOnDestroy() {
        this.dispose();
    }

    private dispose() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }
}
