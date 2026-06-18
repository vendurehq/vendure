import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, interval, Observable, of, Subject } from 'rxjs';
import {
    bufferWhen,
    debounceTime,
    delayWhen,
    distinctUntilChanged,
    filter,
    map,
    skip,
    takeUntil,
    tap,
} from 'rxjs/operators';

export interface ContextMenuConfig {
    ref: any;
    iconShape?: string;
    title: string;
    element: Element;
    coords: { left: number; right: number; top: number; bottom: number };
    items: ContextMenuItem[];
}

export interface ContextMenuItem {
    separator?: boolean;
    iconClass?: string;
    iconShape?: string;
    label: string;
    enabled: boolean;
    onClick: () => void;
}

@Injectable({ providedIn: 'root' })
export class ContextMenuService {
    contextMenu$: Observable<ContextMenuConfig | undefined>;
    private menuIsVisible$ = new BehaviorSubject<boolean>(false);
    private setContextMenuConfig$ = new Subject<ContextMenuConfig | undefined>();
    constructor() {
        const source$ = this.setContextMenuConfig$.asObservable();
        const groupedConfig$ = source$.pipe(
            bufferWhen(() => source$.pipe(debounceTime(50))),
            map(group =>
                group.reduce((acc, cur) => {
                    if (!acc) {
                        return cur;
                    } else {
                        if (cur?.ref === acc.ref) {
                            acc.items.push(
                                // de-duplicate items
                                ...(cur?.items.filter(i => !acc.items.find(ai => ai.label === i.label)) ??
                                    []),
                            );
                        }
                    }
                    return acc;
                }, undefined as ContextMenuConfig | undefined),
            ),
        );

        const visible$ = this.menuIsVisible$.pipe(filter(val => val === true));

        const isVisible$ = this.menuIsVisible$.pipe(
            delayWhen(value => (value ? of(value) : interval(250).pipe(takeUntil(visible$)))),
            distinctUntilChanged(),
        );
        this.contextMenu$ = combineLatest(groupedConfig$, isVisible$).pipe(
            map(([config, isVisible]) => (isVisible ? config : undefined)),
        );
    }

    setVisibility(isVisible: boolean) {
        this.menuIsVisible$.next(isVisible);
    }

    setContextMenu(config: ContextMenuConfig) {
        this.setContextMenuConfig$.next(config);
    }

    clearContextMenu() {
        this.setContextMenuConfig$.next(undefined);
    }
}
