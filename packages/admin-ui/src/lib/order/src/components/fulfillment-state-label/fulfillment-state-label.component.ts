import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
    selector: 'vdr-fulfillment-state-label',
    templateUrl: './fulfillment-state-label.component.html',
    styleUrls: ['./fulfillment-state-label.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class FulfillmentStateLabelComponent {
    @Input() state: string;

    get chipColorType() {
        switch (this.state) {
            case 'Pending':
            case 'Shipped':
                return 'warning';
            case 'Delivered':
                return 'success';
            case 'Cancelled':
                return 'error';
        }
    }
}
