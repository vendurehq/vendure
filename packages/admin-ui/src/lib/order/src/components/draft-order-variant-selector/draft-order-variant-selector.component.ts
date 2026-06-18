import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { UntypedFormControl, UntypedFormGroup } from '@angular/forms';
import { CurrencyCode, CustomFieldConfig, DataService, GetProductVariantQuery } from '@vendure/admin-ui/core';
import { Observable, Subject } from 'rxjs';
import { switchMap } from 'rxjs/operators';

@Component({
    selector: 'vdr-draft-order-variant-selector',
    templateUrl: './draft-order-variant-selector.component.html',
    styleUrls: ['./draft-order-variant-selector.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class DraftOrderVariantSelectorComponent implements OnInit {
    @Input() currencyCode: CurrencyCode;
    @Input() orderLineCustomFields: CustomFieldConfig[];
    @Output() addItem = new EventEmitter<{ productVariantId: string; quantity: number; customFields: any }>();
    customFieldsFormGroup = new UntypedFormGroup({});
    selectedVariant$: Observable<GetProductVariantQuery['productVariant']>;
    selectedVariantId$ = new Subject<string | undefined>();
    quantity = 1;
    constructor(private dataService: DataService) {}

    ngOnInit(): void {
        this.selectedVariant$ = this.selectedVariantId$.pipe(
            switchMap(id => {
                if (id) {
                    return this.dataService.product
                        .getProductVariant(id)
                        .mapSingle(({ productVariant }) => productVariant);
                } else {
                    return [undefined];
                }
            }),
        );
        for (const customField of this.orderLineCustomFields) {
            this.customFieldsFormGroup.addControl(customField.name, new UntypedFormControl(''));
        }
    }

    addItemClick(selectedVariant: GetProductVariantQuery['productVariant']) {
        if (selectedVariant) {
            this.addItem.emit({
                productVariantId: selectedVariant.id,
                quantity: this.quantity,
                customFields: this.orderLineCustomFields.length
                    ? this.customFieldsFormGroup.value
                    : undefined,
            });
            this.selectedVariantId$.next(undefined);
            this.customFieldsFormGroup.reset();
        }
    }
}
