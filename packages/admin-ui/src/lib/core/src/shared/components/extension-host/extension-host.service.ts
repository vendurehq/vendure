import { Injectable, OnDestroy } from '@angular/core';
import { ActivatedRouteSnapshot, Router } from '@angular/router';
import { ActiveRouteData, ExtensionMessage, MessageResponse } from '@vendure/common/lib/extension-host-types';
import { assertNever } from '@vendure/common/lib/shared-utils';
import { parse } from 'graphql';
import { merge, Observer, Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';

import { DataService } from '../../../data/providers/data.service';
import { NotificationService } from '../../../providers/notification/notification.service';

@Injectable()
export class ExtensionHostService implements OnDestroy {
    private extensionWindow: Window;
    private routeSnapshot: ActivatedRouteSnapshot;
    private cancellationMessage$ = new Subject<string>();
    private destroyMessage$ = new Subject<void>();

    constructor(private dataService: DataService, private notificationService: NotificationService) {}

    init(extensionWindow: Window, routeSnapshot: ActivatedRouteSnapshot) {
        this.extensionWindow = extensionWindow;
        this.routeSnapshot = routeSnapshot;
        window.addEventListener('message', this.handleMessage);
    }

    destroy() {
        window.removeEventListener('message', this.handleMessage);
        this.destroyMessage$.next();
    }

    ngOnDestroy(): void {
        this.destroy();
    }

    private handleMessage = (message: MessageEvent<ExtensionMessage>) => {
        const { data, origin } = message;
        if (this.isExtensionMessage(data)) {
            const cancellation$ = this.cancellationMessage$.pipe(
                filter(requestId => requestId === data.requestId),
            );
            const end$ = merge(cancellation$, this.destroyMessage$);
            switch (data.type) {
                case 'cancellation': {
                    this.cancellationMessage$.next(data.requestId);
                    break;
                }
                case 'destroy': {
                    this.destroyMessage$.next();
                    break;
                }
                case 'active-route': {
                    const routeData: ActiveRouteData = {
                        url: window.location.href,
                        origin: window.location.origin,
                        pathname: window.location.pathname,
                        params: this.routeSnapshot.params,
                        queryParams: this.routeSnapshot.queryParams,
                        fragment: this.routeSnapshot.fragment,
                    };
                    this.sendMessage(
                        { data: routeData, error: false, complete: false, requestId: data.requestId },
                        origin,
                    );
                    this.sendMessage(
                        { data: null, error: false, complete: true, requestId: data.requestId },
                        origin,
                    );
                    break;
                }
                case 'graphql-query': {
                    const { document, variables, fetchPolicy } = data.data;
                    this.dataService
                        .query(parse(document), variables, fetchPolicy)
                        .stream$.pipe(takeUntil(end$))
                        .subscribe(this.createObserver(data.requestId, origin));
                    break;
                }
                case 'graphql-mutation': {
                    const { document, variables } = data.data;
                    this.dataService
                        .mutate(parse(document), variables)
                        .pipe(takeUntil(end$))
                        .subscribe(this.createObserver(data.requestId, origin));
                    break;
                }
                case 'notification': {
                    this.notificationService.notify(data.data);
                    break;
                }
                default:
                    assertNever(data);
            }
        }
    };

    private createObserver(requestId: string, origin: string): Observer<any> {
        return {
            next: data => this.sendMessage({ data, error: false, complete: false, requestId }, origin),
            error: err => this.sendMessage({ data: err, error: true, complete: false, requestId }, origin),
            complete: () => this.sendMessage({ data: null, error: false, complete: true, requestId }, origin),
        };
    }

    private sendMessage(response: MessageResponse, origin: string) {
        this.extensionWindow.postMessage(response, origin);
    }

    private isExtensionMessage(input: any): input is ExtensionMessage {
        return (
            input.hasOwnProperty('type') && input.hasOwnProperty('data') && input.hasOwnProperty('requestId')
        );
    }
}
