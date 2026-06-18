import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CurrencyCode, OrderDetailFragment } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-refund-detail',
    templateUrl: './refund-detail.component.html',
    styleUrls: ['./refund-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class RefundDetailComponent {
    @Input() refund: NonNullable<OrderDetailFragment['payments']>[number]['refunds'][number];
    @Input() currencyCode: CurrencyCode;
}
