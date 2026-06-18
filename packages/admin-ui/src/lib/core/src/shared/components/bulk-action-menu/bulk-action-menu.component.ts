import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    Injector,
    Input,
    OnDestroy,
    OnInit,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { SelectionManager } from '../../../common/utilities/selection-manager';
import { DataService } from '../../../data/providers/data.service';
import { BulkActionRegistryService } from '../../../providers/bulk-action-registry/bulk-action-registry.service';
import {
    BulkAction,
    BulkActionFunctionContext,
    BulkActionLocationId,
} from '../../../providers/bulk-action-registry/bulk-action-types';

@Component({
    selector: 'vdr-bulk-action-menu',
    templateUrl: './bulk-action-menu.component.html',
    styleUrls: ['./bulk-action-menu.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class BulkActionMenuComponent<T = any> implements OnInit, OnDestroy {
    @Input() locationId: BulkActionLocationId;
    @Input() selectionManager: SelectionManager<T>;
    @Input() hostComponent: any;
    actions$: Observable<
        Array<BulkAction<T> & { display: boolean; translationVars: Record<string, string | number> }>
    >;
    userPermissions: string[] = [];

    private subscription: Subscription;
    private onClearSelectionFns: Array<() => void> = [];

    constructor(
        private bulkActionRegistryService: BulkActionRegistryService,
        private injector: Injector,
        private route: ActivatedRoute,
        private dataService: DataService,
        private changeDetectorRef: ChangeDetectorRef,
    ) {}

    ngOnInit(): void {
        const actionsForLocation = this.bulkActionRegistryService.getBulkActionsForLocation(this.locationId);
        this.actions$ = this.selectionManager.selectionChanges$.pipe(
            switchMap(selection =>
                Promise.all(
                    actionsForLocation.map(async action => {
                        let display = true;
                        let translationVars = {};
                        const isVisibleFn = action.isVisible;
                        const getTranslationVarsFn = action.getTranslationVars;
                        const functionContext: BulkActionFunctionContext<T, any> = {
                            injector: this.injector,
                            hostComponent: this.hostComponent,
                            route: this.route,
                            selection,
                        };
                        if (typeof isVisibleFn === 'function') {
                            display = await isVisibleFn(functionContext);
                        }
                        if (typeof getTranslationVarsFn === 'function') {
                            translationVars = await getTranslationVarsFn(functionContext);
                        }
                        return { ...action, display, translationVars };
                    }),
                ),
            ),
        );
        this.subscription = this.dataService.client
            .userStatus()
            .mapStream(({ userStatus }) => {
                this.userPermissions = userStatus.permissions;
            })
            .subscribe();
    }

    ngOnDestroy() {
        this.subscription?.unsubscribe();
    }

    hasPermissions(bulkAction: Pick<BulkAction, 'requiresPermission'>) {
        if (!this.userPermissions) {
            return false;
        }
        if (!bulkAction.requiresPermission) {
            return true;
        }
        if (typeof bulkAction.requiresPermission === 'string') {
            return this.userPermissions.includes(bulkAction.requiresPermission);
        }
        if (typeof bulkAction.requiresPermission === 'function') {
            return bulkAction.requiresPermission(this.userPermissions);
        }
    }

    actionClick(event: MouseEvent, action: BulkAction) {
        action.onClick({
            injector: this.injector,
            event,
            route: this.route,
            selection: this.selectionManager.selection,
            hostComponent: this.hostComponent,
            clearSelection: () => this.selectionManager.clearSelection(),
        });
    }

    clearSelection() {
        this.selectionManager.clearSelection();
        this.changeDetectorRef.markForCheck();
        this.onClearSelectionFns.forEach(fn => fn());
    }

    onClearSelection(callback: () => void) {
        this.onClearSelectionFns.push(callback);
    }
}
