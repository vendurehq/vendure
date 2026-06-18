import { ChangeDetectionStrategy, Component, EventEmitter, OnInit, Output } from '@angular/core';
import {
    CurrencyCode,
    DataService,
    LocalStorageService,
    ProductSelectorSearchQuery,
} from '@vendure/admin-ui/core';

type SearchItem = ProductSelectorSearchQuery['search']['items'][number];

export interface TestOrderLine {
    id: string;
    name: string;
    preview: string;
    sku: string;
    unitPriceWithTax: number;
    quantity: number;
}

@Component({
    selector: 'vdr-test-order-builder',
    templateUrl: './test-order-builder.component.html',
    styleUrls: ['./test-order-builder.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class TestOrderBuilderComponent implements OnInit {
    @Output() orderLinesChange = new EventEmitter<TestOrderLine[]>();
    lines: TestOrderLine[] = [];
    currencyCode: CurrencyCode;
    get subTotal(): number {
        return this.lines.reduce((sum, l) => sum + l.unitPriceWithTax * l.quantity, 0);
    }

    constructor(private dataService: DataService, private localStorageService: LocalStorageService) {}

    ngOnInit() {
        this.lines = this.loadFromLocalStorage();
        if (this.lines) {
            this.orderLinesChange.emit(this.lines);
        }
        this.dataService.settings.getActiveChannel('cache-first').single$.subscribe(result => {
            this.currencyCode = result.activeChannel.defaultCurrencyCode;
        });
    }

    selectResult(result: SearchItem) {
        if (result) {
            this.addToLines(result);
        }
    }

    private addToLines(result: SearchItem) {
        if (!this.lines.find(l => l.id === result.productVariantId)) {
            this.lines.push({
                id: result.productVariantId,
                name: result.productVariantName,
                preview: result.productAsset?.preview ?? '',
                quantity: 1,
                sku: result.sku,
                unitPriceWithTax:
                    (result.priceWithTax.__typename === 'SinglePrice' && result.priceWithTax.value) || 0,
            });
            this.persistToLocalStorage();
            this.orderLinesChange.emit(this.lines);
        }
    }

    updateQuantity() {
        this.persistToLocalStorage();
        this.orderLinesChange.emit(this.lines);
    }

    removeLine(line: TestOrderLine) {
        this.lines = this.lines.filter(l => l.id !== line.id);
        this.persistToLocalStorage();
        this.orderLinesChange.emit(this.lines);
    }

    private persistToLocalStorage() {
        this.localStorageService.setForCurrentLocation('shippingTestOrder', this.lines);
    }

    private loadFromLocalStorage(): TestOrderLine[] {
        return this.localStorageService.getForCurrentLocation('shippingTestOrder') || [];
    }
}
