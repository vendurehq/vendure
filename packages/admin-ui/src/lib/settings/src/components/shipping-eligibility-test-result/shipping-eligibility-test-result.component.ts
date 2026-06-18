import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { CurrencyCode, ShippingMethodQuote } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-shipping-eligibility-test-result',
    templateUrl: './shipping-eligibility-test-result.component.html',
    styleUrls: ['./shipping-eligibility-test-result.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ShippingEligibilityTestResultComponent {
    @Input() testResult: ShippingMethodQuote[];
    @Input() okToRun = false;
    @Input() testDataUpdated = false;
    @Input() currencyCode: CurrencyCode;
    @Output() runTest = new EventEmitter<void>();
}
