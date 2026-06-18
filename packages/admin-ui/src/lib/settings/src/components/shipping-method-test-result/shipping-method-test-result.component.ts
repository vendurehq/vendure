import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';

import { CurrencyCode, TestShippingMethodResult } from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-shipping-method-test-result',
    templateUrl: './shipping-method-test-result.component.html',
    styleUrls: ['./shipping-method-test-result.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ShippingMethodTestResultComponent {
    @Input() testResult: TestShippingMethodResult;
    @Input() okToRun = false;
    @Input() testDataUpdated = false;
    @Input() currencyCode: CurrencyCode;
    @Output() runTest = new EventEmitter<void>();
}
