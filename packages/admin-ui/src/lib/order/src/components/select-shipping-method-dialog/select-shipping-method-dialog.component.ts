import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import {
    CreateAddressInput,
    CurrencyCode,
    Dialog,
    DraftOrderEligibleShippingMethodsQuery,
} from '@vendure/admin-ui/core';

type ShippingMethodQuote =
    DraftOrderEligibleShippingMethodsQuery['eligibleShippingMethodsForDraftOrder'][number];

@Component({
    selector: 'vdr-select-shipping-method-dialog',
    templateUrl: './select-shipping-method-dialog.component.html',
    styleUrls: ['./select-shipping-method-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class SelectShippingMethodDialogComponent implements OnInit, Dialog<string> {
    resolveWith: (result?: string) => void;
    eligibleShippingMethods: ShippingMethodQuote[];
    currentSelectionId: string;
    currencyCode: CurrencyCode;
    selectedMethod: ShippingMethodQuote | undefined;

    ngOnInit(): void {
        if (this.currentSelectionId) {
            this.selectedMethod = this.eligibleShippingMethods.find(m => m.id === this.currentSelectionId);
        }
    }

    methodIdFn(item: ShippingMethodQuote) {
        return item.id;
    }

    cancel() {
        this.resolveWith();
    }

    select() {
        if (this.selectedMethod) {
            this.resolveWith(this.selectedMethod.id);
        }
    }
}
