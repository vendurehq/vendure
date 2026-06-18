import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CustomerFragment } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-customer-status-label',
    templateUrl: './customer-status-label.component.html',
    styleUrls: ['./customer-status-label.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CustomerStatusLabelComponent {
    @Input() customer: CustomerFragment;
}
