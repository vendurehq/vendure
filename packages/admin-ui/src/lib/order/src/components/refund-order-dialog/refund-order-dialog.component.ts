import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CancelOrderInput,
    DataService,
    Dialog,
    getAppConfig,
    I18nService,
    OrderDetailFragment,
    OrderLineInput,
    PaymentWithRefundsFragment,
    PreviewRefundLineTotalDocument,
    RefundOrderInput,
} from '@vendure/admin-ui/core';
import { summate } from '@vendure/common/lib/shared-utils';
import { gql } from 'apollo-angular';
import { of, Subject } from 'rxjs';
import { catchError, map, switchMap, takeUntil } from 'rxjs/operators';
import { getRefundablePayments, RefundablePayment } from '../../common/get-refundable-payments';

type SelectionLine = { quantity: number; cancel: boolean };

export const PREVIEW_REFUND_LINE_TOTAL = gql`
    query PreviewRefundLineTotal($orderId: ID!, $lines: [OrderLineInput!]!) {
        previewRefundLineTotal(orderId: $orderId, lines: $lines)
    }
`;

@Component({
    selector: 'vdr-refund-order-dialog',
    templateUrl: './refund-order-dialog.component.html',
    styleUrls: ['./refund-order-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class RefundOrderDialogComponent
    implements OnInit, OnDestroy, Dialog<{ cancel: CancelOrderInput; refunds: RefundOrderInput[] }>
{
    order: OrderDetailFragment;
    resolveWith: (result?: { cancel: CancelOrderInput; refunds: RefundOrderInput[] }) => void;
    reason: string;
    lineQuantities: { [lineId: string]: SelectionLine } = {};
    refundablePayments: RefundablePayment[] = [];
    refundShippingLineIds: string[] = [];
    reasons = getAppConfig().cancellationReasons ?? [
        _('order.refund-reason-customer-request'),
        _('order.refund-reason-not-available'),
    ];
    manuallySetRefundTotal = false;
    refundTotal = 0;
    isCalculating = false;
    private lineSelectionChange$ = new Subject<OrderLineInput[]>();
    private destroy$ = new Subject<void>();

    constructor(
        private i18nService: I18nService,
        private dataService: DataService,
        private changeDetector: ChangeDetectorRef,
    ) {
        this.reasons = this.reasons.map(r => this.i18nService.translate(r));
    }

    get totalRefundableAmount(): number {
        return summate(this.refundablePayments, 'refundableAmount');
    }

    get amountToRefundTotal(): number {
        return this.refundablePayments.reduce(
            (total, payment) => total + payment.amountToRefundControl.value,
            0,
        );
    }

    lineCanBeRefundedOrCancelled(line: OrderDetailFragment['lines'][number]): boolean {
        return this.getRefundedQuantity(line) < line.orderPlacedQuantity;
    }

    private getRefundedQuantity(line: OrderDetailFragment['lines'][number]): number {
        return (
            this.order.payments
                ?.reduce(
                    (all, payment) => [...all, ...payment.refunds],
                    [] as PaymentWithRefundsFragment['refunds'],
                )
                .filter(refund => refund.state !== 'Failed')
                .reduce(
                    (all, refund) => [...all, ...refund.lines],
                    [] as Array<{ orderLineId: string; quantity: number }>,
                )
                .filter(refundLine => refundLine.orderLineId === line.id)
                .reduce((sum, refundLine) => sum + refundLine.quantity, 0) ?? 0
        );
    }

    ngOnInit() {
        this.lineQuantities = this.order.lines.reduce(
            (result, line) => ({
                ...result,
                [line.id]: {
                    quantity: 0,
                    refund: true,
                    cancel: false,
                },
            }),
            {},
        );
        this.refundablePayments = getRefundablePayments(this.order.payments);
        // The server calculates the line total, so that the refund matches what it records,
        // including lines priced by `calculateLinePrice`. A newer selection cancels a pending one.
        this.lineSelectionChange$
            .pipe(
                switchMap(lines =>
                    lines.length
                        ? this.dataService
                              .query(
                                  PreviewRefundLineTotalDocument,
                                  { orderId: this.order.id, lines },
                                  'network-only',
                              )
                              .single$.pipe(
                                  map(result => result.previewRefundLineTotal),
                                  // The error is shown by the data service. Leave the total as it was.
                                  catchError(() => of(undefined)),
                              )
                        : of(0),
                ),
                takeUntil(this.destroy$),
            )
            .subscribe(lineTotal => {
                // A failed preview keeps the dialog from submitting until the selection changes.
                this.isCalculating = lineTotal == null;
                if (lineTotal != null && !this.manuallySetRefundTotal) {
                    this.refundTotal = lineTotal + this.getShippingTotal();
                    this.allocateRefundTotal();
                }
                this.changeDetector.markForCheck();
            });
    }

    ngOnDestroy() {
        this.destroy$.next();
        this.destroy$.complete();
    }

    updateRefundTotal() {
        if (!this.manuallySetRefundTotal) {
            this.isCalculating = true;
            this.lineSelectionChange$.next(this.getOrderLineInput(() => true));
            return;
        }
        this.allocateRefundTotal();
    }

    private getShippingTotal(): number {
        return this.order.shippingLines.reduce((total, line) => {
            if (this.refundShippingLineIds.includes(line.id)) {
                return total + line.discountedPriceWithTax;
            } else {
                return total;
            }
        }, 0);
    }

    // allocate the refund total across the refundable payments
    private allocateRefundTotal() {
        const refundablePayments = this.refundablePayments.filter(p => p.selected);
        let refundsAllocated = 0;
        for (const payment of refundablePayments) {
            const amountToRefund = Math.min(payment.refundableAmount, this.refundTotal - refundsAllocated);
            payment.amountToRefundControl.setValue(amountToRefund);
            refundsAllocated += amountToRefund;
        }
    }

    toggleShippingRefund(lineId: string) {
        const index = this.refundShippingLineIds.indexOf(lineId);
        if (index === -1) {
            this.refundShippingLineIds.push(lineId);
        } else {
            this.refundShippingLineIds.splice(index, 1);
        }
        this.updateRefundTotal();
    }

    onRefundQuantityChange(orderLineId: string, quantity: number) {
        this.manuallySetRefundTotal = false;
        const selectionLine = this.lineQuantities[orderLineId];
        if (selectionLine) {
            const previousQuantity = selectionLine.quantity;
            if (quantity === 0) {
                selectionLine.cancel = false;
            } else if (previousQuantity === 0 && quantity > 0) {
                selectionLine.cancel = true;
            }
            selectionLine.quantity = quantity;
            this.updateRefundTotal();
        }
    }

    onPaymentSelected(payment: RefundablePayment, selected: boolean) {
        if (selected) {
            const outstandingRefundAmount =
                this.refundTotal -
                this.refundablePayments
                    .filter(p => p.id !== payment.id)
                    .reduce((total, p) => total + p.amountToRefundControl.value, 0);
            if (0 < outstandingRefundAmount) {
                payment.amountToRefundControl.setValue(
                    Math.min(outstandingRefundAmount, payment.refundableAmount),
                );
            }
        } else {
            payment.amountToRefundControl.setValue(0);
        }
    }

    isRefunding(): boolean {
        const result = Object.values(this.lineQuantities).reduce(
            (isRefunding, line) => isRefunding || 0 < line.quantity,
            false,
        );
        return result;
    }

    isCancelling(): boolean {
        const result = Object.values(this.lineQuantities).reduce(
            (isCancelling, line) => isCancelling || (0 < line.quantity && line.cancel),
            false,
        );
        return result;
    }

    canSubmit(): boolean {
        return (
            !this.isCalculating &&
            0 < this.refundTotal &&
            this.amountToRefundTotal === this.refundTotal &&
            !!this.reason
        );
    }

    select() {
        const refundLines = this.getOrderLineInput(() => true);
        const cancelLines = this.getOrderLineInput(line => line.cancel);

        this.resolveWith({
            refunds: this.refundablePayments
                .filter(rp => rp.selected && 0 < rp.amountToRefundControl.value)
                .map((payment, index) => {
                    return {
                        // Each refund records its lines as refunded, so only the first one carries them.
                        lines: index === 0 ? refundLines : [],
                        reason: this.reason,
                        paymentId: payment.id,
                        amount: payment.amountToRefundControl.value,
                        shipping: 0,
                        adjustment: 0,
                    };
                }),
            cancel: {
                lines: cancelLines,
                orderId: this.order.id,
                reason: this.reason,
                cancelShipping: this.refundShippingLineIds.length > 0,
            },
        });
    }

    cancel() {
        this.resolveWith();
    }

    private getOrderLineInput(filterFn: (line: SelectionLine) => boolean): OrderLineInput[] {
        return Object.entries(this.lineQuantities)
            .filter(([orderLineId, line]) => 0 < line.quantity && filterFn(line))
            .map(([orderLineId, line]) => ({
                orderLineId,
                quantity: line.quantity,
            }));
    }
}
