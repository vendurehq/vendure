import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormControl, Validators } from '@angular/forms';
import {
    AdministratorRefundInput,
    CustomFieldConfig,
    Dialog,
    ModifyOrderInput,
    OrderDetailFragment,
} from '@vendure/admin-ui/core';
import { getRefundablePayments, RefundablePayment } from '../../common/get-refundable-payments';
import { AddedLine, OrderSnapshot } from '../../common/modify-order-types';
import { OrderEditorComponent } from '../order-editor/order-editor.component';

export enum OrderEditResultType {
    Refund,
    Payment,
    PriceUnchanged,
    Cancel,
}

interface OrderEditsRefundResult {
    result: OrderEditResultType.Refund;
    refunds: AdministratorRefundInput[];
}
interface OrderEditsPaymentResult {
    result: OrderEditResultType.Payment;
}
interface OrderEditsPriceUnchangedResult {
    result: OrderEditResultType.PriceUnchanged;
}
interface OrderEditsCancelResult {
    result: OrderEditResultType.Cancel;
}
type OrderEditResult =
    | OrderEditsRefundResult
    | OrderEditsPaymentResult
    | OrderEditsPriceUnchangedResult
    | OrderEditsCancelResult;

@Component({
    selector: 'vdr-order-edits-preview-dialog',
    templateUrl: './order-edits-preview-dialog.component.html',
    styleUrls: ['./order-edits-preview-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderEditsPreviewDialogComponent implements OnInit, Dialog<OrderEditResult> {
    // Passed in via the modalService
    orderLineCustomFields: CustomFieldConfig[];
    order: OrderDetailFragment;
    orderSnapshot: OrderSnapshot;
    modifyOrderInput: ModifyOrderInput;
    addedLines: AddedLine[];
    shippingAddressForm: OrderEditorComponent['shippingAddressForm'];
    billingAddressForm: OrderEditorComponent['billingAddressForm'];
    updatedShippingMethods: OrderEditorComponent['updatedShippingMethods'];
    couponCodesControl: FormControl<string[] | null>;

    refundablePayments: RefundablePayment[];
    refundNote: string;
    resolveWith: (result?: OrderEditResult) => void;

    get priceDifference(): number {
        return this.order.totalWithTax - this.orderSnapshot.totalWithTax;
    }

    get amountToRefundTotal(): number {
        return this.refundablePayments.reduce(
            (total, payment) => total + payment.amountToRefundControl.value,
            0,
        );
    }

    ngOnInit() {
        this.refundNote = this.modifyOrderInput.note || '';
        this.refundablePayments = getRefundablePayments(this.order.payments || []);
        this.refundablePayments.forEach(rp => {
            rp.amountToRefundControl.addValidators(Validators.max(this.priceDifference * -1));
        });
        if (this.priceDifference < 0 && this.refundablePayments.length) {
            this.onPaymentSelected(this.refundablePayments[0], true);
        }
    }

    onPaymentSelected(payment: RefundablePayment, selected: boolean) {
        if (selected) {
            const outstandingRefundAmount =
                this.priceDifference * -1 -
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

    refundsCoverDifference(): boolean {
        return this.priceDifference * -1 === this.amountToRefundTotal;
    }

    cancel() {
        this.resolveWith({
            result: OrderEditResultType.Cancel,
        });
    }

    submit() {
        if (0 < this.priceDifference) {
            this.resolveWith({
                result: OrderEditResultType.Payment,
            });
        } else if (this.priceDifference < 0) {
            this.resolveWith({
                result: OrderEditResultType.Refund,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                refunds: this.refundablePayments
                    .filter(rp => rp.selected && 0 < rp.amountToRefundControl.value)
                    .map(payment => {
                        return {
                            reason: this.refundNote || this.modifyOrderInput.note,
                            paymentId: payment.id,
                            amount: payment.amountToRefundControl.value,
                        };
                    }),
            });
        } else {
            this.resolveWith({
                result: OrderEditResultType.PriceUnchanged,
            });
        }
    }
}
