import { Injectable, Injector } from '@angular/core';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import {
    BehaviorSubject,
    combineLatest,
    first,
    isObservable,
    Observable,
    of,
    Subject,
    Subscription,
    switchMap,
} from 'rxjs';
import { filter, map, startWith, take } from 'rxjs/operators';
import { Permission } from '../../common/generated-types';
import { DataService } from '../../data/providers/data.service';
import { ModalService } from '../modal/modal.service';
import { NotificationService } from '../notification/notification.service';
import { PermissionsService } from '../permissions/permissions.service';

/**
 * @description
 * The context object which is passed to the `check`, `isAlert`, `label` and `action` functions of an
 * {@link AlertConfig} object.
 *
 * @since 2.2.0
 * @docsCategory alerts
 */
export interface AlertContext {
    /**
     * @description
     * The Angular [Injector](https://angular.dev/api/core/Injector) which can be used to get instances
     * of services and other providers available in the application.
     */
    injector: Injector;
    /**
     * @description
     * The [DataService](/reference/admin-ui-api/services/data-service), which provides methods for querying the
     * server-side data.
     */
    dataService: DataService;
    /**
     * @description
     * The [NotificationService](/reference/admin-ui-api/services/notification-service), which provides methods for
     * displaying notifications to the user.
     */
    notificationService: NotificationService;
    /**
     * @description
     * The [ModalService](/reference/admin-ui-api/services/modal-service), which provides methods for
     * opening modal dialogs.
     */
    modalService: ModalService;
}

/**
 * @description
 * A configuration object for an Admin UI alert.
 *
 * @since 2.2.0
 * @docsCategory alerts
 */
export interface AlertConfig<T = any> {
    /**
     * @description
     * A unique identifier for the alert.
     */
    id: string;
    /**
     * @description
     * A function which is gets the data used to determine whether the alert should be shown.
     * Typically, this function will query the server or some other remote data source.
     *
     * This function will be called once when the Admin UI app bootstraps, and can be also
     * set to run at regular intervals by setting the `recheckIntervalMs` property.
     */
    check: (context: AlertContext) => T | Promise<T> | Observable<T>;
    /**
     * @description
     * A function which returns an Observable which is used to determine when to re-run the `check`
     * function. Whenever the observable emits, the `check` function will be called again.
     *
     * A basic time-interval-based recheck can be achieved by using the `interval` function from RxJS.
     *
     * @example
     * ```ts
     * import { interval } from 'rxjs';
     *
     * // ...
     * recheck: () => interval(60_000)
     * ```
     *
     * If this is not set, the `check` function will only be called once when the Admin UI app bootstraps.
     *
     * @default undefined
     */
    recheck?: (context: AlertContext) => Observable<any>;
    /**
     * @description
     * A function which determines whether the alert should be shown based on the data returned by the `check`
     * function.
     */
    isAlert: (data: T, context: AlertContext) => boolean;
    /**
     * @description
     * A function which is called when the alert is clicked in the Admin UI.
     */
    action: (data: T, context: AlertContext) => void;
    /**
     * @description
     * A function which returns the text used in the UI to describe the alert.
     */
    label: (
        data: T,
        context: AlertContext,
    ) => { text: string; translationVars?: { [key: string]: string | number } };
    /**
     * @description
     * A list of permissions which the current Administrator must have in order. If the current
     * Administrator does not have these permissions, none of the other alert functions will be called.
     */
    requiredPermissions?: Permission[];
}

export interface ActiveAlert {
    id: string;
    runAction: () => void;
    hasRun: boolean;
    label: { text: string; translationVars?: { [key: string]: string | number } };
}

export class Alert<T> {
    activeAlert$: Observable<ActiveAlert | undefined>;
    private hasRun$ = new BehaviorSubject(false);
    private data$ = new BehaviorSubject<T | undefined>(undefined);
    private readonly subscription: Subscription;
    constructor(
        private config: AlertConfig<T>,
        private context: AlertContext,
    ) {
        if (this.config.recheck) {
            this.subscription = this.config.recheck(this.context).subscribe(() => this.runCheck());
        }
        this.activeAlert$ = combineLatest([this.data$, this.hasRun$]).pipe(
            map(([data, hasRun]) => {
                if (!data) {
                    return;
                }
                const isAlert = this.config.isAlert(data, this.context);
                if (!isAlert) {
                    return;
                }
                return {
                    id: this.config.id,
                    runAction: () => {
                        if (!hasRun) {
                            this.config.action(data, this.context);
                            this.hasRun$.next(true);
                        }
                    },
                    hasRun,
                    label: this.config.label(data, this.context),
                };
            }),
        );
    }
    get id() {
        return this.config.id;
    }
    runCheck() {
        const result = this.config.check(this.context);
        if (result instanceof Promise) {
            result.then(data => this.data$.next(data));
        } else if (isObservable(result)) {
            result.pipe(take(1)).subscribe(data => this.data$.next(data));
        } else {
            this.data$.next(result);
        }
        this.hasRun$.next(false);
    }

    destroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }
}

@Injectable({
    providedIn: 'root',
})
export class AlertsService {
    activeAlerts$: Observable<ActiveAlert[]>;
    private alertsMap = new Map<string, Alert<any>>();
    private configUpdated = new Subject<void>();

    constructor(
        private permissionsService: PermissionsService,
        private injector: Injector,
        private dataService: DataService,
        private notificationService: NotificationService,
        private modalService: ModalService,
    ) {
        const alerts$ = this.configUpdated.pipe(
            map(() => [...this.alertsMap.values()]),
            startWith([...this.alertsMap.values()]),
        );

        this.activeAlerts$ = alerts$.pipe(
            switchMap(() => {
                const alerts = [...this.alertsMap.values()];
                const isAlertStreams = alerts.map(alert => alert.activeAlert$);
                return combineLatest(isAlertStreams);
            }),
            map(alertStates => alertStates.filter(notNullOrUndefined)),
        );
    }

    configureAlert<T>(config: AlertConfig<T>) {
        this.hasSufficientPermissions(config.requiredPermissions)
            .pipe(first())
            .subscribe(hasPermissions => {
                if (hasPermissions) {
                    this.alertsMap.set(config.id, new Alert(config, this.createContext()));
                    this.configUpdated.next();
                }
            });
    }

    hasSufficientPermissions(permissions?: Permission[]) {
        if (!permissions || permissions.length === 0) {
            return of(true);
        }
        return this.permissionsService.currentUserPermissions$.pipe(
            filter(permissions => permissions.length > 0),
            map(() => this.permissionsService.userHasPermissions(permissions)),
        );
    }

    refresh(id?: string) {
        if (id) {
            this.alertsMap.get(id)?.runCheck();
        } else {
            this.alertsMap.forEach(config => config.runCheck());
        }
    }

    clearAlerts() {
        this.alertsMap.forEach(alert => alert.destroy());
        this.alertsMap.clear();
        this.configUpdated.next();
    }

    protected createContext(): AlertContext {
        return {
            injector: this.injector,
            dataService: this.dataService,
            notificationService: this.notificationService,
            modalService: this.modalService,
        };
    }
}
