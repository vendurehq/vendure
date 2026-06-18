import { Injectable } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    HistoryEntryType,
    I18nService,
    ModalService,
    NotificationService,
    SortOrder,
} from '@vendure/admin-ui/core';
import { EMPTY } from 'rxjs';
import { catchError, delay, map, retryWhen, switchMap, take } from 'rxjs/operators';

import { OrderStateSelectDialogComponent } from '../components/order-state-select-dialog/order-state-select-dialog.component';

@Injectable({
    providedIn: 'root',
})
export class OrderTransitionService {
    constructor(
        private dataService: DataService,
        private modalService: ModalService,
        private notificationService: NotificationService,
        private i18nService: I18nService,
    ) {}

    /**
     * Attempts to transition the Order to the last state it was in before it was transitioned
     * to the "Modifying" state. If this fails, a manual prompt is used.
     */
    transitionToPreModifyingState(orderId: string, nextStates: string[]) {
        return this.getPreModifyingState(orderId).pipe(
            switchMap(state => {
                const manualTransitionOptions = {
                    orderId,
                    nextStates,
                    message: this.i18nService.translate(
                        _('order.unable-to-transition-to-state-try-another'),
                        { state },
                    ),
                    cancellable: false,
                    retry: 10,
                };
                if (state) {
                    return this.transitionToStateOrThrow(orderId, state).pipe(
                        catchError(err => this.manuallyTransitionToState(manualTransitionOptions)),
                    );
                } else {
                    return this.manuallyTransitionToState(manualTransitionOptions);
                }
            }),
        );
    }

    /**
     * Displays a modal for manually selecting the next state.
     */
    manuallyTransitionToState(options: {
        orderId: string;
        nextStates: string[];
        message: string;
        cancellable: boolean;
        retry: number;
    }) {
        return this.modalService
            .fromComponent(OrderStateSelectDialogComponent, {
                locals: {
                    nextStates: options.nextStates,
                    cancellable: options.cancellable,
                    message: options.message,
                },
                closable: false,
                size: 'md',
            })
            .pipe(
                switchMap(result => {
                    if (result) {
                        return this.transitionToStateOrThrow(options.orderId, result);
                    } else {
                        if (!options.cancellable) {
                            throw new Error(`An order state must be selected`);
                        } else {
                            return EMPTY;
                        }
                    }
                }),
                retryWhen(errors => errors.pipe(delay(2000), take(options.retry))),
            );
    }

    /**
     * Attempts to get the last state the Order was in before it was transitioned
     * to the "Modifying" state.
     */
    private getPreModifyingState(orderId: string) {
        return this.dataService.order
            .getOrderHistory(orderId, {
                filter: {
                    type: {
                        eq: HistoryEntryType.ORDER_STATE_TRANSITION,
                    },
                },
                sort: {
                    createdAt: SortOrder.DESC,
                },
            })
            .mapSingle(result => result.order)
            .pipe(
                map(result => {
                    const item = result?.history.items.find(i => i.data.to === 'Modifying');
                    if (item) {
                        return item.data.from as string;
                    } else {
                        return;
                    }
                }),
            );
    }

    private transitionToStateOrThrow(orderId: string, state: string) {
        return this.dataService.order.transitionToState(orderId, state).pipe(
            map(({ transitionOrderToState }) => {
                switch (transitionOrderToState?.__typename) {
                    case 'Order':
                        return transitionOrderToState?.state;
                    case 'OrderStateTransitionError':
                        this.notificationService.error(transitionOrderToState?.transitionError);
                        throw new Error(transitionOrderToState?.transitionError);
                }
            }),
        );
    }
}
