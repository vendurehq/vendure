import { Directive, HostBinding, inject, Injector, Input, OnChanges, SimpleChanges } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BehaviorSubject, Observable, of, switchMap } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { ActionBarLocationId } from '../../../common/component-registry-types';
import { DataService } from '../../../data/providers/data.service';
import {
    ActionBarButtonState,
    ActionBarContext,
    ActionBarDropdownMenuItem,
    ActionBarItem,
} from '../../../providers/nav-builder/nav-builder-types';
import { NavBuilderService } from '../../../providers/nav-builder/nav-builder.service';
import { NotificationService } from '../../../providers/notification/notification.service';

@Directive()
export abstract class ActionBarBaseComponent<T extends ActionBarItem | ActionBarDropdownMenuItem>
    implements OnChanges
{
    @HostBinding('attr.data-location-id')
    @Input()
    locationId: ActionBarLocationId;

    items$: Observable<T[]>;
    buttonStates: { [id: string]: Observable<ActionBarButtonState> } = {};
    protected locationId$ = new BehaviorSubject<string>('');
    protected navBuilderService = inject(NavBuilderService);
    protected route = inject(ActivatedRoute);
    protected dataService = inject(DataService);
    protected notificationService = inject(NotificationService);
    protected injector = inject(Injector);

    ngOnChanges(changes: SimpleChanges): void {
        if ('locationId' in changes) {
            this.locationId$.next(changes['locationId'].currentValue);
        }
    }

    handleClick(event: MouseEvent, item: T) {
        if (typeof item.onClick === 'function') {
            item.onClick(event, this.createContext());
        }
    }

    getRouterLink(item: T): any[] | null {
        return this.navBuilderService.getRouterLink(
            { routerLink: item.routerLink, context: this.createContext() },
            this.route,
        );
    }

    protected buildButtonStates(items: T[]) {
        const context = this.createContext();
        const defaultState = {
            disabled: false,
            visible: true,
        };
        for (const item of items) {
            const buttonState$ =
                typeof item.buttonState === 'function'
                    ? item.buttonState(context).pipe(
                          map(result => result ?? defaultState),
                          catchError(() => of(defaultState)),
                      )
                    : of(defaultState);
            this.buttonStates[item.id] = buttonState$;
        }
    }

    protected createContext(): ActionBarContext {
        return {
            route: this.route,
            injector: this.injector,
            dataService: this.dataService,
            notificationService: this.notificationService,
            entity$: this.route.data.pipe(
                switchMap(data => {
                    if (data.detail?.entity) {
                        return data.detail.entity as Observable<Record<string, any>>;
                    } else {
                        return of(undefined);
                    }
                }),
            ),
        };
    }
}
