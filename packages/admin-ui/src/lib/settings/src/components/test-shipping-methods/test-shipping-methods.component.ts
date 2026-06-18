import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import {
    DataService,
    GetActiveChannelQuery,
    ShippingMethodQuote,
    TestEligibleShippingMethodsInput,
} from '@vendure/admin-ui/core';
import { Observable, Subject } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { TestAddress } from '../test-address-form/test-address-form.component';
import { TestOrderLine } from '../test-order-builder/test-order-builder.component';

@Component({
    selector: 'vdr-test-shipping-methods',
    templateUrl: './test-shipping-methods.component.html',
    styleUrls: ['./test-shipping-methods.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class TestShippingMethodsComponent implements OnInit {
    activeChannel$: Observable<GetActiveChannelQuery['activeChannel']>;
    testAddress: TestAddress;
    testOrderLines: TestOrderLine[];
    testDataUpdated = false;
    testResult$: Observable<ShippingMethodQuote[] | undefined>;
    private fetchTestResult$ = new Subject<[TestAddress, TestOrderLine[]]>();

    constructor(private dataService: DataService) {}

    ngOnInit() {
        this.activeChannel$ = this.dataService.settings
            .getActiveChannel()
            .mapStream(data => data.activeChannel);
        this.testResult$ = this.fetchTestResult$.pipe(
            switchMap(([address, lines]) => {
                const input: TestEligibleShippingMethodsInput = {
                    shippingAddress: { ...address, streetLine1: 'test' },
                    lines: lines.map(l => ({ productVariantId: l.id, quantity: l.quantity })),
                };
                return this.dataService.shippingMethod
                    .testEligibleShippingMethods(input)
                    .mapSingle(result => result.testEligibleShippingMethods);
            }),
        );
    }

    setTestOrderLines(event: TestOrderLine[]) {
        this.testOrderLines = event;
        this.testDataUpdated = true;
    }

    setTestAddress(event: TestAddress) {
        this.testAddress = event;
        this.testDataUpdated = true;
    }

    allTestDataPresent(): boolean {
        return !!(this.testAddress && this.testOrderLines && this.testOrderLines.length);
    }

    runTest() {
        this.fetchTestResult$.next([this.testAddress, this.testOrderLines]);
        this.testDataUpdated = false;
    }
}
