import { FormControl, Validators } from '@angular/forms';
import { OrderDetailFragment } from '@vendure/admin-ui/core';
import { summate } from '@vendure/common/lib/shared-utils';

export type Payment = NonNullable<OrderDetailFragment['payments']>[number];
export type RefundablePayment = Payment & {
    refundableAmount: number;
    amountToRefundControl: FormControl<number>;
    selected: boolean;
};

export function getRefundablePayments(payments: OrderDetailFragment['payments']): RefundablePayment[] {
    const settledPayments = (payments || []).filter(p => p.state === 'Settled');
    return settledPayments.map((payment, index) => {
        const refundableAmount =
            payment.amount -
            summate(
                payment.refunds.filter(r => r.state !== 'Failed'),
                'total',
            );
        return {
            ...payment,
            refundableAmount,
            amountToRefundControl: new FormControl(0, {
                nonNullable: true,
                validators: [Validators.min(0), Validators.max(refundableAmount)],
            }),
            selected: index === 0,
        };
    });
}
