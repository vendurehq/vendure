import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CurrencyCode, OrderDetailFragment } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-payment-detail',
    templateUrl: './payment-detail.component.html',
    styleUrls: ['./payment-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class PaymentDetailComponent {
    @Input() payment: NonNullable<OrderDetailFragment['payments']>[number];
    @Input() currencyCode: CurrencyCode;
}
