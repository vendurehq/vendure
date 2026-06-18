import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { UntypedFormGroup } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    AddressFragment,
    CreateAddressInput,
    DataService,
    DeletionResult,
    DraftOrderEligibleShippingMethodsQuery,
    GetCustomerAddressesDocument,
    ModalService,
    NotificationService,
    Order,
    OrderDetailFragment,
    OrderDetailQueryDocument,
    TypedBaseDetailComponent,
} from '@vendure/admin-ui/core';
import { combineLatest, forkJoin, Observable, of, Subject } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';

import { OrderTransitionService } from '../../providers/order-transition.service';
import { SelectAddressDialogComponent } from '../select-address-dialog/select-address-dialog.component';
import { SelectCustomerDialogComponent } from '../select-customer-dialog/select-customer-dialog.component';
import { SelectShippingMethodDialogComponent } from '../select-shipping-method-dialog/select-shipping-method-dialog.component';

@Component({
    selector: 'vdr-draft-order-detail',
    templateUrl: './draft-order-detail.component.html',
    styleUrls: ['./draft-order-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DraftOrderDetailComponent
    extends TypedBaseDetailComponent<typeof OrderDetailQueryDocument, 'order'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('Order');
    orderLineCustomFields = this.getCustomFieldConfig('OrderLine');
    detailForm = new UntypedFormGroup({});
    eligibleShippingMethods$: Observable<
        DraftOrderEligibleShippingMethodsQuery['eligibleShippingMethodsForDraftOrder']
    >;
    nextStates$: Observable<string[]>;
    fetchHistory = new Subject<void>();
    displayCouponCodeInput = false;

    constructor(
        private changeDetector: ChangeDetectorRef,
        protected dataService: DataService,
        private notificationService: NotificationService,
        private modalService: ModalService,
        private orderTransitionService: OrderTransitionService,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
        this.orderLineCustomFields = this.getCustomFieldConfig('OrderLine');
        this.eligibleShippingMethods$ = this.entity$.pipe(
            switchMap(order =>
                this.dataService.order
                    .getDraftOrderEligibleShippingMethods(order.id)
                    .mapSingle(
                        ({ eligibleShippingMethodsForDraftOrder }) => eligibleShippingMethodsForDraftOrder,
                    ),
            ),
        );
    }

    ngOnDestroy() {
        this.destroy();
    }

    addItemToOrder(event: { productVariantId: string; quantity: number; customFields: any }) {
        this.dataService.order.addItemToDraftOrder(this.id, event).subscribe(result => {
            if (result.addItemToDraftOrder.__typename !== 'Order') {
                this.notificationService.error((result.addItemToDraftOrder as any).message);
            }
        });
    }

    adjustOrderLine(event: { lineId: string; quantity: number }) {
        this.dataService.order
            .adjustDraftOrderLine(this.id, { orderLineId: event.lineId, quantity: event.quantity })
            .subscribe(result => {
                if (result.adjustDraftOrderLine.__typename !== 'Order') {
                    this.notificationService.error((result.adjustDraftOrderLine as any).message);
                }
            });
    }

    removeOrderLine(event: { lineId: string }) {
        this.dataService.order.removeDraftOrderLine(this.id, event.lineId).subscribe(result => {
            if (result.removeDraftOrderLine.__typename !== 'Order') {
                this.notificationService.error((result.removeDraftOrderLine as any).message);
            }
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

    setCustomer() {
        this.modalService.fromComponent(SelectCustomerDialogComponent).subscribe(result => {
            if (this.hasId(result)) {
                this.dataService.order
                    .setCustomerForDraftOrder(this.id, { customerId: result.id })
                    .pipe(
                        switchMap(() => {
                            return this.dataService.query(GetCustomerAddressesDocument, {
                                customerId: result.id,
                            }).single$;
                        }),
                        switchMap(({ customer }) => {
                            const defaultShippingAddress = customer?.addresses?.find(
                                addr => addr.defaultShippingAddress,
                            );
                            const defaultBillingAddress = customer?.addresses?.find(
                                addr => addr.defaultBillingAddress,
                            );

                            return forkJoin([
                                defaultShippingAddress
                                    ? this.dataService.order.setDraftOrderShippingAddress(
                                          this.id,
                                          this.mapToAddressInput(defaultShippingAddress),
                                      )
                                    : this.dataService.order.unsetDraftOrderShippingAddress(this.id),
                                defaultBillingAddress
                                    ? this.dataService.order.setDraftOrderBillingAddress(
                                          this.id,
                                          this.mapToAddressInput(defaultBillingAddress),
                                      )
                                    : this.dataService.order.unsetDraftOrderBillingAddress(this.id),
                            ]);
                        }),
                    )
                    .subscribe();
            } else if (result) {
                const { note, ...input } = result;
                this.dataService.order.setCustomerForDraftOrder(this.id, { input }).subscribe();
            }
        });
    }

    private mapToAddressInput(address: AddressFragment): CreateAddressInput {
        return {
            fullName: address.fullName,
            company: address.company,
            streetLine1: address.streetLine1,
            streetLine2: address.streetLine2,
            city: address.city,
            province: address.province,
            postalCode: address.postalCode,
            countryCode: address.country.code,
            phoneNumber: address.phoneNumber,
            defaultShippingAddress: address.defaultShippingAddress,
            defaultBillingAddress: address.defaultBillingAddress,
        };
    }

    setShippingAddress() {
        this.entity$
            .pipe(
                take(1),
                switchMap(order =>
                    this.modalService.fromComponent(SelectAddressDialogComponent, {
                        locals: {
                            customerId: order.customer?.id,
                            currentAddress: order.shippingAddress ?? undefined,
                        },
                    }),
                ),
            )
            .subscribe(result => {
                if (result) {
                    this.dataService.order.setDraftOrderShippingAddress(this.id, result).subscribe();
                }
            });
    }

    setBillingAddress() {
        this.entity$
            .pipe(
                take(1),
                switchMap(order =>
                    this.modalService.fromComponent(SelectAddressDialogComponent, {
                        locals: {
                            customerId: order.customer?.id,
                            currentAddress: order.billingAddress ?? undefined,
                        },
                    }),
                ),
            )
            .subscribe(result => {
                if (result) {
                    this.dataService.order.setDraftOrderBillingAddress(this.id, result).subscribe();
                }
            });
    }

    applyCouponCode(couponCode: string) {
        this.dataService.order.applyCouponCodeToDraftOrder(this.id, couponCode).subscribe();
    }

    removeCouponCode(couponCode: string) {
        this.dataService.order.removeCouponCodeFromDraftOrder(this.id, couponCode).subscribe();
    }

    setShippingMethod() {
        combineLatest(this.entity$, this.eligibleShippingMethods$)
            .pipe(
                take(1),
                switchMap(([order, methods]) =>
                    this.modalService.fromComponent(SelectShippingMethodDialogComponent, {
                        locals: {
                            eligibleShippingMethods: methods,
                            currencyCode: order.currencyCode,
                            currentSelectionId: order.shippingLines?.[0]?.shippingMethod.id,
                        },
                    }),
                ),
            )
            .subscribe(result => {
                if (result) {
                    this.dataService.order.setDraftOrderShippingMethod(this.id, result).subscribe();
                }
            });
    }

    updateCustomFields(customFieldsValue: any) {
        this.dataService.order
            .updateOrderCustomFields({
                id: this.id,
                customFields: customFieldsValue,
            })
            .subscribe();
    }

    deleteOrder() {
        this.dataService.order.deleteDraftOrder(this.id).subscribe(({ deleteDraftOrder }) => {
            if (deleteDraftOrder.result === DeletionResult.DELETED) {
                this.notificationService.success(_('common.notify-delete-success'), {
                    entity: 'Order',
                });
                this.router.navigate(['/orders']);
            } else if (deleteDraftOrder.message) {
                this.notificationService.error(deleteDraftOrder.message);
            }
        });
    }

    completeOrder() {
        this.dataService.order
            .transitionToState(this.id, 'ArrangingPayment')
            .subscribe(({ transitionOrderToState }) => {
                if (transitionOrderToState?.__typename === 'Order') {
                    this.router.navigate(['/orders', this.id]);
                } else if (transitionOrderToState?.__typename === 'OrderStateTransitionError') {
                    this.notificationService.error(transitionOrderToState.transitionError);
                }
            });
    }

    private hasId<T extends { id: string }>(input: T | any): input is { id: string } {
        return typeof input === 'object' && !!input.id;
    }

    protected setFormValues(entity: OrderDetailFragment): void {
        // empty
    }
}
