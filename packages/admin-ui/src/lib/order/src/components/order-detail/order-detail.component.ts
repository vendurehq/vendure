import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    EditNoteDialogComponent,
    FulfillmentFragment,
    getCustomFieldsDefaults,
    GetOrderHistoryQuery,
    GetOrderQuery,
    ModalService,
    NotificationService,
    ORDER_DETAIL_FRAGMENT,
    OrderDetailFragment,
    OrderDetailQueryDocument,
    Refund,
    SetOrderCustomerDocument,
    SortOrder,
    TimelineHistoryEntry,
    TypedBaseDetailComponent,
} from '@vendure/admin-ui/core';
import { assertNever, summate } from '@vendure/common/lib/shared-utils';
import { gql } from 'apollo-angular';
import { EMPTY, forkJoin, Observable, of, Subject } from 'rxjs';
import { map, mapTo, startWith, switchMap, take } from 'rxjs/operators';

import { OrderTransitionService } from '../../providers/order-transition.service';
import { AddManualPaymentDialogComponent } from '../add-manual-payment-dialog/add-manual-payment-dialog.component';
import { CancelOrderDialogComponent } from '../cancel-order-dialog/cancel-order-dialog.component';
import { FulfillOrderDialogComponent } from '../fulfill-order-dialog/fulfill-order-dialog.component';
import { OrderProcessGraphDialogComponent } from '../order-process-graph-dialog/order-process-graph-dialog.component';
import { RefundOrderDialogComponent } from '../refund-order-dialog/refund-order-dialog.component';
import { SelectCustomerDialogComponent } from '../select-customer-dialog/select-customer-dialog.component';
import { SettleRefundDialogComponent } from '../settle-refund-dialog/settle-refund-dialog.component';

type Payment = NonNullable<OrderDetailFragment['payments']>[number];

export const ORDER_DETAIL_QUERY = gql`
    query OrderDetailQuery($id: ID!) {
        order(id: $id) {
            ...OrderDetail
        }
    }
    ${ORDER_DETAIL_FRAGMENT}
`;

export const SET_ORDER_CUSTOMER_MUTATION = gql`
    mutation SetOrderCustomer($input: SetOrderCustomerInput!) {
        setOrderCustomer(input: $input) {
            id
            customer {
                id
                firstName
                lastName
                emailAddress
            }
        }
    }
`;

@Component({
    selector: 'vdr-order-detail',
    templateUrl: './order-detail.component.html',
    styleUrls: ['./order-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderDetailComponent
    extends TypedBaseDetailComponent<typeof OrderDetailQueryDocument, 'order'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('Order');
    orderLineCustomFields = this.getCustomFieldConfig('OrderLine');
    detailForm = new FormGroup({
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    history$: Observable<NonNullable<GetOrderHistoryQuery['order']>['history']['items'] | undefined>;
    nextStates$: Observable<string[]>;
    fetchHistory = new Subject<void>();
    private readonly defaultStates = [
        'AddingItems',
        'ArrangingPayment',
        'PaymentAuthorized',
        'PaymentSettled',
        'PartiallyShipped',
        'Shipped',
        'PartiallyDelivered',
        'Delivered',
        'Cancelled',
        'Modifying',
        'ArrangingAdditionalPayment',
    ];

    constructor(
        private changeDetector: ChangeDetectorRef,
        protected dataService: DataService,
        private notificationService: NotificationService,
        private modalService: ModalService,
        private orderTransitionService: OrderTransitionService,
        private formBuilder: FormBuilder,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
        this.entity$.pipe(take(1)).subscribe(order => {
            if (order.state === 'Modifying') {
                this.router.navigate(['./', 'modify'], { relativeTo: this.route });
            }
        });
        this.history$ = this.fetchHistory.pipe(
            startWith(null),
            switchMap(() =>
                this.dataService.order
                    .getOrderHistory(this.id, {
                        sort: {
                            createdAt: SortOrder.DESC,
                        },
                    })
                    .mapStream(data => data.order?.history.items),
            ),
        );
        this.nextStates$ = this.entity$.pipe(
            map(order => {
                const isInCustomState = !this.defaultStates.includes(order.state);
                return isInCustomState
                    ? order.nextStates
                    : order.nextStates.filter(s => !this.defaultStates.includes(s));
            }),
        );
    }

    ngOnDestroy() {
        this.destroy();
    }

    openStateDiagram() {
        this.entity$
            .pipe(
                take(1),
                switchMap(order =>
                    this.modalService.fromComponent(OrderProcessGraphDialogComponent, {
                        closable: true,
                        locals: {
                            activeState: order.state,
                        },
                    }),
                ),
            )
            .subscribe();
    }

    setOrderCustomer() {
        this.modalService
            .fromComponent(SelectCustomerDialogComponent, {
                locals: {
                    canCreateNew: false,
                    includeNoteInput: true,
                    title: _('order.assign-order-to-another-customer'),
                },
            })
            .pipe(
                switchMap(result => {
                    function isExisting(input: any): input is { id: string } {
                        return typeof input === 'object' && !!input.id;
                    }
                    if (isExisting(result)) {
                        return this.dataService.mutate(SetOrderCustomerDocument, {
                            input: {
                                customerId: result.id,
                                orderId: this.id,
                                note: result.note,
                            },
                        });
                    } else {
                        return EMPTY;
                    }
                }),
                switchMap(result => this.refetchOrder(result)),
            )
            .subscribe(result => {
                if (result) {
                    this.notificationService.success(_('order.set-customer-success'));
                }
            });
    }

    transitionToState(state: string) {
        this.dataService.order.transitionToState(this.id, state).subscribe(({ transitionOrderToState }) => {
            switch (transitionOrderToState?.__typename) {
                case 'Order':
                    this.notificationService.success(_('order.transitioned-to-state-success'), { state });
                    this.fetchHistory.next();
                    break;
                case 'OrderStateTransitionError':
                    this.notificationService.error(transitionOrderToState.transitionError);
            }
        });
    }

    manuallyTransitionToState(order: OrderDetailFragment) {
        this.orderTransitionService
            .manuallyTransitionToState({
                orderId: order.id,
                nextStates: order.nextStates,
                cancellable: true,
                message: _('order.manually-transition-to-state-message'),
                retry: 0,
            })
            .subscribe();
    }

    transitionToModifying() {
        this.dataService.order
            .transitionToState(this.id, 'Modifying')
            .subscribe(({ transitionOrderToState }) => {
                switch (transitionOrderToState?.__typename) {
                    case 'Order':
                        this.router.navigate(['./modify'], { relativeTo: this.route });
                        break;
                    case 'OrderStateTransitionError':
                        this.notificationService.error(transitionOrderToState.transitionError);
                }
            });
    }

    updateCustomFields() {
        this.dataService.order
            .updateOrderCustomFields({
                id: this.id,
                customFields: this.detailForm.value.customFields,
            })
            .subscribe(() => {
                this.notificationService.success(_('common.notify-update-success'), { entity: 'Order' });
            });
    }

    getOrderAddressLines(orderAddress?: { [key: string]: string }): string[] {
        if (!orderAddress) {
            return [];
        }
        return Object.values(orderAddress)
            .filter(val => val !== 'OrderAddress')
            .filter(line => !!line);
    }

    settlePayment(payment: Payment) {
        this.dataService.order.settlePayment(payment.id).subscribe(({ settlePayment }) => {
            switch (settlePayment.__typename) {
                case 'Payment':
                    if (settlePayment.state === 'Settled') {
                        this.notificationService.success(_('order.settle-payment-success'));
                    } else {
                        this.notificationService.error(_('order.settle-payment-error'));
                    }
                    this.dataService.order.getOrder(this.id).single$.subscribe();
                    this.fetchHistory.next();
                    break;
                case 'OrderStateTransitionError':
                case 'PaymentStateTransitionError':
                case 'SettlePaymentError':
                    this.notificationService.error(settlePayment.message);
            }
        });
    }

    transitionPaymentState({ payment, state }: { payment: Payment; state: string }) {
        if (state === 'Cancelled') {
            this.dataService.order.cancelPayment(payment.id).subscribe(({ cancelPayment }) => {
                switch (cancelPayment.__typename) {
                    case 'Payment':
                        this.notificationService.success(_('order.transitioned-payment-to-state-success'), {
                            state,
                        });
                        this.dataService.order.getOrder(this.id).single$.subscribe();
                        this.fetchHistory.next();
                        break;
                    case 'PaymentStateTransitionError':
                        this.notificationService.error(cancelPayment.transitionError);
                        break;
                    case 'CancelPaymentError':
                        this.notificationService.error(cancelPayment.paymentErrorMessage);
                        break;
                }
            });
        } else {
            this.dataService.order
                .transitionPaymentToState(payment.id, state)
                .subscribe(({ transitionPaymentToState }) => {
                    switch (transitionPaymentToState.__typename) {
                        case 'Payment':
                            this.notificationService.success(
                                _('order.transitioned-payment-to-state-success'),
                                {
                                    state,
                                },
                            );
                            this.dataService.order.getOrder(this.id).single$.subscribe();
                            this.fetchHistory.next();
                            break;
                        case 'PaymentStateTransitionError':
                            this.notificationService.error(transitionPaymentToState.message);
                            break;
                    }
                });
        }
    }

    canAddFulfillment(order: OrderDetailFragment): boolean {
        const allFulfillmentLines: FulfillmentFragment['lines'] = (order.fulfillments ?? [])
            .filter(fulfillment => fulfillment.state !== 'Cancelled')
            .reduce((all, fulfillment) => [...all, ...fulfillment.lines], [] as FulfillmentFragment['lines']);
        let allItemsFulfilled = true;
        for (const line of order.lines) {
            const totalFulfilledCount = allFulfillmentLines
                .filter(row => row.orderLineId === line.id)
                .reduce((sum, row) => sum + row.quantity, 0);
            if (totalFulfilledCount < line.quantity) {
                allItemsFulfilled = false;
            }
        }
        return (
            !allItemsFulfilled &&
            !this.hasUnsettledModifications(order) &&
            this.outstandingPaymentAmount(order) === 0 &&
            (order.nextStates.includes('Shipped') ||
                order.nextStates.includes('PartiallyShipped') ||
                order.nextStates.includes('Delivered'))
        );
    }

    hasUnsettledModifications(order: OrderDetailFragment): boolean {
        return 0 < order.modifications.filter(m => !m.isSettled).length;
    }

    getOutstandingModificationAmount(order: OrderDetailFragment): number {
        return summate(
            order.modifications.filter(m => !m.isSettled),
            'priceChange',
        );
    }

    outstandingPaymentAmount(order: OrderDetailFragment): number {
        const paymentIsValid = (p: Payment): boolean =>
            p.state !== 'Cancelled' && p.state !== 'Declined' && p.state !== 'Error';

        let amountCovered = 0;
        for (const payment of order.payments?.filter(paymentIsValid) ?? []) {
            const refunds = payment.refunds.filter(r => r.state !== 'Failed') ?? [];
            const refundsTotal = summate(refunds as Array<Required<Refund>>, 'total');
            amountCovered += payment.amount - refundsTotal;
        }
        return order.totalWithTax - amountCovered;
    }

    addManualPayment(order: OrderDetailFragment) {
        const priorState = order.state;
        this.modalService
            .fromComponent(AddManualPaymentDialogComponent, {
                closable: true,
                locals: {
                    outstandingAmount: this.outstandingPaymentAmount(order),
                    currencyCode: order.currencyCode,
                },
            })
            .pipe(
                switchMap(result => {
                    if (result) {
                        return this.dataService.order.addManualPaymentToOrder({
                            orderId: this.id,
                            transactionId: result.transactionId,
                            method: result.method,
                            metadata: result.metadata || {},
                        });
                    } else {
                        return EMPTY;
                    }
                }),
                switchMap(({ addManualPaymentToOrder }) => {
                    switch (addManualPaymentToOrder.__typename) {
                        case 'Order':
                            this.notificationService.success(_('order.add-payment-to-order-success'));
                            if (priorState === 'ArrangingAdditionalPayment') {
                                return this.orderTransitionService.transitionToPreModifyingState(
                                    order.id,
                                    order.nextStates,
                                );
                            } else {
                                return of('PaymentSettled');
                            }
                        case 'ManualPaymentStateError':
                            this.notificationService.error(addManualPaymentToOrder.message);
                            return EMPTY;
                        default:
                            return EMPTY;
                    }
                }),
            )
            .subscribe(result => {
                if (result) {
                    this.refetchOrder({ result });
                }
            });
    }

    fulfillOrder() {
        this.entity$
            .pipe(
                take(1),
                switchMap(order =>
                    this.modalService.fromComponent(FulfillOrderDialogComponent, {
                        size: 'xl',
                        locals: {
                            order,
                        },
                    }),
                ),
                switchMap(input => {
                    if (input) {
                        return this.dataService.order.createFulfillment(input);
                    } else {
                        return of(undefined);
                    }
                }),
                switchMap(result => this.refetchOrder(result).pipe(mapTo(result))),
            )
            .subscribe(result => {
                if (result) {
                    const { addFulfillmentToOrder } = result;
                    switch (addFulfillmentToOrder.__typename) {
                        case 'Fulfillment':
                            this.notificationService.success(_('order.create-fulfillment-success'));
                            break;
                        case 'EmptyOrderLineSelectionError':
                        case 'InsufficientStockOnHandError':
                        case 'ItemsAlreadyFulfilledError':
                        case 'InvalidFulfillmentHandlerError':
                            this.notificationService.error(addFulfillmentToOrder.message);
                            break;
                        case 'FulfillmentStateTransitionError':
                            this.notificationService.error(addFulfillmentToOrder.transitionError);
                            break;
                        case 'CreateFulfillmentError':
                            this.notificationService.error(addFulfillmentToOrder.fulfillmentHandlerError);
                            break;
                        case undefined:
                            this.notificationService.error(JSON.stringify(addFulfillmentToOrder));
                            break;
                        default:
                            assertNever(addFulfillmentToOrder);
                    }
                }
            });
    }

    transitionFulfillment(id: string, state: string) {
        this.dataService.order
            .transitionFulfillmentToState(id, state)
            .pipe(switchMap(result => this.refetchOrder(result)))
            .subscribe(() => {
                this.notificationService.success(_('order.successfully-updated-fulfillment'));
            });
    }

    cancelOrRefund(order: OrderDetailFragment) {
        const isRefundable = this.orderHasSettledPayments(order);
        if (order.state === 'PaymentAuthorized' || order.active === true || !isRefundable) {
            this.cancelOrder(order);
        } else {
            this.refundOrder(order);
        }
    }

    settleRefund(refund: Payment['refunds'][number]) {
        this.modalService
            .fromComponent(SettleRefundDialogComponent, {
                size: 'md',
                locals: {
                    refund,
                },
            })
            .pipe(
                switchMap(transactionId => {
                    if (transactionId) {
                        return this.dataService.order.settleRefund(
                            {
                                transactionId,
                                id: refund.id,
                            },
                            this.id,
                        );
                    } else {
                        return of(undefined);
                    }
                }),
                // switchMap(result => this.refetchOrder(result)),
            )
            .subscribe(result => {
                if (result) {
                    this.notificationService.success(_('order.settle-refund-success'));
                }
            });
    }

    addNote(event: { note: string; isPublic: boolean }) {
        const { note, isPublic } = event;
        this.dataService.order
            .addNoteToOrder({
                id: this.id,
                note,
                isPublic,
            })
            .pipe(switchMap(result => this.refetchOrder(result)))
            .subscribe(result => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'Note',
                });
            });
    }

    updateNote(entry: TimelineHistoryEntry) {
        this.modalService
            .fromComponent(EditNoteDialogComponent, {
                closable: true,
                locals: {
                    displayPrivacyControls: true,
                    note: entry.data.note,
                    noteIsPrivate: !entry.isPublic,
                },
            })
            .pipe(
                switchMap(result => {
                    if (result) {
                        return this.dataService.order.updateOrderNote({
                            noteId: entry.id,
                            isPublic: !result.isPrivate,
                            note: result.note,
                        });
                    } else {
                        return EMPTY;
                    }
                }),
            )
            .subscribe(result => {
                this.fetchHistory.next();
                this.notificationService.success(_('common.notify-update-success'), {
                    entity: 'Note',
                });
            });
    }

    deleteNote(entry: TimelineHistoryEntry) {
        return this.modalService
            .dialog({
                title: _('common.confirm-delete-note'),
                body: entry.data.note,
                buttons: [
                    { type: 'secondary', label: _('common.cancel') },
                    { type: 'danger', label: _('common.delete'), returnValue: true },
                ],
            })
            .pipe(switchMap(res => (res ? this.dataService.order.deleteOrderNote(entry.id) : EMPTY)))
            .subscribe(() => {
                this.fetchHistory.next();
                this.notificationService.success(_('common.notify-delete-success'), {
                    entity: 'Note',
                });
            });
    }

    orderHasSettledPayments(order: OrderDetailFragment): boolean {
        return !!order.payments?.find(p => p.state === 'Settled');
    }

    private cancelOrder(order: OrderDetailFragment) {
        this.modalService
            .fromComponent(CancelOrderDialogComponent, {
                size: 'xl',
                locals: {
                    order,
                },
            })
            .pipe(
                switchMap(input => {
                    if (input) {
                        return this.dataService.order.cancelOrder(input);
                    } else {
                        return of(undefined);
                    }
                }),
                switchMap(result => this.refetchOrder(result)),
            )
            .subscribe(result => {
                if (result) {
                    this.notificationService.success(_('order.cancelled-order-success'));
                }
            });
    }

    private refundOrder(order: OrderDetailFragment) {
        this.modalService
            .fromComponent(RefundOrderDialogComponent, {
                size: 'xl',
                locals: {
                    order,
                },
            })
            .pipe(
                switchMap(input => {
                    if (!input) {
                        return of(undefined);
                    }

                    if (input.cancel.lines?.length) {
                        return this.dataService.order.cancelOrder(input.cancel).pipe(
                            map(res => {
                                const result = res.cancelOrder;
                                switch (result.__typename) {
                                    case 'Order':
                                        this.refetchOrder(result).subscribe();
                                        this.notificationService.success(
                                            _('order.cancelled-order-items-success'),
                                            {
                                                count: summate(input.cancel.lines, 'quantity'),
                                            },
                                        );
                                        return input;
                                    case 'CancelActiveOrderError':
                                    case 'QuantityTooGreatError':
                                    case 'MultipleOrderError':
                                    case 'OrderStateTransitionError':
                                    case 'EmptyOrderLineSelectionError':
                                        this.notificationService.error(result.message);
                                        return undefined;
                                }
                            }),
                        );
                    } else {
                        return [input];
                    }
                }),
                switchMap(input => {
                    if (!input) {
                        return of(undefined);
                    }
                    if (input.refunds.length) {
                        return forkJoin(
                            input.refunds.map(refund =>
                                this.dataService.order.refundOrder(refund).pipe(map(res => res.refundOrder)),
                            ),
                        );
                    } else {
                        return [undefined];
                    }
                }),
            )
            .subscribe(results => {
                for (const result of results ?? []) {
                    if (result) {
                        switch (result.__typename) {
                            case 'Refund':
                                if (result.state === 'Failed') {
                                    this.notificationService.error(_('order.refund-order-failed'));
                                } else {
                                    this.notificationService.success(_('order.refund-order-success'));
                                }
                                break;
                            case 'AlreadyRefundedError':
                            case 'NothingToRefundError':
                            case 'PaymentOrderMismatchError':
                            case 'RefundOrderStateError':
                            case 'RefundStateTransitionError':
                                this.notificationService.error(result.message);
                                break;
                        }
                    }
                }
                this.refetchOrder(results?.[0]).subscribe();
            });
    }

    private refetchOrder(result: object | undefined): Observable<GetOrderQuery | undefined> {
        this.fetchHistory.next();
        if (result) {
            return this.dataService.order.getOrder(this.id).single$;
        } else {
            return of(undefined);
        }
    }

    protected setFormValues(entity: OrderDetailFragment): void {
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get(['customFields']), entity);
        }
    }
}
