import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * @description
 * Displays the state of an order in a colored chip.
 *
 * @example
 * ```HTML
 * <vdr-order-state-label [state]="order.state"></vdr-order-state-label>
 * ```
 * @docsCategory components
 */
@Component({
    selector: 'vdr-order-state-label',
    templateUrl: './order-state-label.component.html',
    styleUrls: ['./order-state-label.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderStateLabelComponent {
    @Input() state: string;

    get chipColorType() {
        switch (this.state) {
            case 'AddingItems':
            case 'ArrangingPayment':
                return '';
            case 'Delivered':
                return 'success';
            case 'Cancelled':
            case 'Draft':
                return 'error';
            case 'PaymentAuthorized':
            case 'PaymentSettled':
            case 'PartiallyDelivered':
            case 'PartiallyShipped':
            case 'Shipped':
            default:
                return 'warning';
        }
    }
}
