import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import type { OrderEditorComponent } from '../order-editor/order-editor.component';
import { AddedLine, ModifyOrderData, OrderSnapshot } from '../../common/modify-order-types';

@Component({
    selector: 'vdr-order-modification-summary',
    templateUrl: './order-modification-summary.component.html',
    styleUrls: ['./order-modification-summary.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderModificationSummaryComponent {
    @Input() orderSnapshot: OrderSnapshot;
    @Input() modifyOrderInput: ModifyOrderData;
    @Input() addedLines: AddedLine[];
    @Input() shippingAddressForm: OrderEditorComponent['shippingAddressForm'];
    @Input() billingAddressForm: OrderEditorComponent['billingAddressForm'];
    @Input() updatedShippingMethods: OrderEditorComponent['updatedShippingMethods'];
    @Input() couponCodesControl: FormControl<string[] | null>;

    get adjustedLines(): string[] {
        return (this.modifyOrderInput.adjustOrderLines || [])
            .map(l => {
                const line = this.orderSnapshot.lines.find(line => line.id === l.orderLineId);
                if (line) {
                    const delta = l.quantity - line.quantity;
                    const sign = delta === 0 ? '' : delta > 0 ? '+' : '-';
                    return delta
                        ? `${sign}${Math.abs(delta)} ${line.productVariant.name}`
                        : line.productVariant.name;
                }
            })
            .filter(notNullOrUndefined);
    }

    getModifiedFields(formGroup: FormGroup): string {
        if (!formGroup.dirty) {
            return '';
        }
        return Object.entries(formGroup.controls)
            .map(([key, control]) => {
                if (control.dirty) {
                    return key;
                }
            })
            .filter(notNullOrUndefined)
            .join(', ');
    }

    getUpdatedShippingMethodLines() {
        return Object.entries(this.updatedShippingMethods || {})
            .map(([lineId, shippingMethod]) => {
                const previousMethod = this.orderSnapshot.shippingLines.find(l => l.id === lineId);
                if (!previousMethod) {
                    return;
                }
                const previousName = previousMethod.shippingMethod.name || previousMethod.shippingMethod.code;
                const newName = shippingMethod.name || shippingMethod.code;
                return `${previousName} -> ${newName}`;
            })
            .filter(notNullOrUndefined);
    }

    get couponCodeChanges(): string[] {
        const originalCodes = this.orderSnapshot.couponCodes || [];
        const newCodes = this.couponCodesControl.value || [];
        const addedCodes = newCodes.filter(c => !originalCodes.includes(c)).map(c => `+ ${c}`);
        const removedCodes = originalCodes.filter(c => !newCodes.includes(c)).map(c => `- ${c}`);
        return [...addedCodes, ...removedCodes];
    }
}
