import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

@Component({
    selector: 'vdr-refund-state-label',
    templateUrl: './refund-state-label.component.html',
    styleUrls: ['./refund-state-label.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class RefundStateLabelComponent {
    @Input() state: string;

    get chipColorType() {
        switch (this.state) {
            case 'Pending':
                return 'warning';
            case 'Settled':
                return 'success';
            case 'Failed':
                return 'error';
        }
    }
}
