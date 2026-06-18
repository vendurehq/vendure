import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { OrderDetailFragment, PaymentWithRefundsFragment } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-line-refunds',
    templateUrl: './line-refunds.component.html',
    styleUrls: ['./line-refunds.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class LineRefundsComponent {
    @Input() line: OrderDetailFragment['lines'][number];
    @Input() payments: PaymentWithRefundsFragment[];

    getRefundedCount(): number {
        const refundLines =
            this.payments
                ?.reduce(
                    (all, payment) => [...all, ...payment.refunds],
                    [] as PaymentWithRefundsFragment['refunds'],
                )
                .filter(refund => refund.state !== 'Failed')
                .reduce(
                    (all, refund) => [...all, ...refund.lines],
                    [] as Array<{ orderLineId: string; quantity: number }>,
                ) ?? [];

        return refundLines
            .filter(i => i.orderLineId === this.line.id)
            .reduce((sum, i) => sum + i.quantity, 0);
    }
}
