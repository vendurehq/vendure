import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
    selector: 'vdr-payment-state-label',
    templateUrl: './payment-state-label.component.html',
    styleUrls: ['./payment-state-label.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class PaymentStateLabelComponent {
    @Input() state: string;

    get chipColorType() {
        switch (this.state) {
            case 'Authorized':
                return 'warning';
            case 'Settled':
                return 'success';
            case 'Declined':
            case 'Cancelled':
                return 'error';
        }
    }
}
