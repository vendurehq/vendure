import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CancelOrderInput,
    Dialog,
    getAppConfig,
    I18nService,
    OrderDetailFragment,
    OrderLineInput,
    PaymentWithRefundsFragment,
    RefundOrderInput,
} from '@vendure/admin-ui/core';
import { summate } from '@vendure/common/lib/shared-utils';
import { getRefundablePayments, RefundablePayment } from '../../common/get-refundable-payments';

type SelectionLine = { quantity: number; cancel: boolean };

@Component({
    selector: 'vdr-refund-order-dialog',
    templateUrl: './refund-order-dialog.component.html',
    styleUrls: ['./refund-order-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class RefundOrderDialogComponent
    implements OnInit, Dialog<{ cancel: CancelOrderInput; refunds: RefundOrderInput[] }>
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

    constructor(private i18nService: I18nService) {
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
        const refundedCount =
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
                .reduce((sum, refundLine) => sum + refundLine.quantity, 0) ?? 0;

        return refundedCount < line.orderPlacedQuantity;
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
    }

    updateRefundTotal() {
        if (!this.manuallySetRefundTotal) {
            const itemTotal = this.order.lines.reduce((total, line) => {
                const lineRef = this.lineQuantities[line.id];
                const refundCount = lineRef.quantity || 0;
                return total + line.proratedUnitPriceWithTax * refundCount;
            }, 0);
            const shippingTotal = this.order.shippingLines.reduce((total, line) => {
                if (this.refundShippingLineIds.includes(line.id)) {
                    return total + line.discountedPriceWithTax;
                } else {
                    return total;
                }
            }, 0);
            this.refundTotal = itemTotal + shippingTotal;
        }

        // allocate the refund total across the refundable payments
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
        return 0 < this.refundTotal && this.amountToRefundTotal === this.refundTotal && !!this.reason;
    }

    select() {
        const refundLines = this.getOrderLineInput(() => true);
        const cancelLines = this.getOrderLineInput(line => line.cancel);

        this.resolveWith({
            refunds: this.refundablePayments
                .filter(rp => rp.selected && 0 < rp.amountToRefundControl.value)
                .map(payment => {
                    return {
                        lines: refundLines,
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
