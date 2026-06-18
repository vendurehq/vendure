import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CurrencyCode, OrderDetailFragment } from '@vendure/admin-ui/core';

type Payment = NonNullable<OrderDetailFragment['payments']>[number];

@Component({
    selector: 'vdr-order-payment-card',
    templateUrl: './order-payment-card.component.html',
    styleUrls: ['./order-payment-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderPaymentCardComponent {
    @Input() payment: Payment;
    @Input() currencyCode: CurrencyCode;
    @Output() settlePayment = new EventEmitter<Payment>();
    @Output() transitionPaymentState = new EventEmitter<{ payment: Payment; state: string }>();
    @Output() settleRefund = new EventEmitter<Payment['refunds'][number]>();

    refundHasMetadata(refund?: Payment['refunds'][number]): boolean {
        return !!refund && Object.keys(refund.metadata).length > 0;
    }

    nextOtherStates(): string[] {
        if (!this.payment) {
            return [];
        }
        return this.payment.nextStates.filter(s => s !== 'Settled' && s !== 'Error');
    }
}
