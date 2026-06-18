import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { DefaultFormComponentId, DefaultFormComponentUiConfig } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { forkJoin, Observable, of } from 'rxjs';
import { map, startWith, switchMap } from 'rxjs/operators';

import { FormInputComponent } from '../../../common/component-registry-types';
import { GetProductVariantQuery, ProductSelectorSearchQuery } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

/**
 * @description
 * Allows the selection of multiple ProductVariants via an autocomplete select input.
 * Should be used with `ID` type **list** fields which represent ProductVariant IDs.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-product-selector-form-input',
    templateUrl: './product-selector-form-input.component.html',
    styleUrls: ['./product-selector-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ProductSelectorFormInputComponent implements FormInputComponent, OnInit {
    static readonly id: DefaultFormComponentId = 'product-selector-form-input';
    readonly isListInput = true;
    readonly: boolean;
    formControl: FormControl<Array<string | { id: string }>>;
    config: DefaultFormComponentUiConfig<'product-selector-form-input'>;
    selection$: Observable<Array<GetProductVariantQuery['productVariant']>>;

    constructor(private dataService: DataService) {}

    ngOnInit() {
        this.formControl.setValidators([
            control => {
                if (!control.value || !control.value.length) {
                    return {
                        atLeastOne: { length: control.value.length },
                    };
                }
                return null;
            },
        ]);

        this.selection$ = this.formControl.valueChanges.pipe(
            startWith(this.formControl.value),
            switchMap(value => {
                if (Array.isArray(value) && 0 < value.length) {
                    return forkJoin(
                        value.map(id =>
                            this.dataService.product
                                .getProductVariant(this.getId(id))
                                .mapSingle(data => data.productVariant),
                        ),
                    );
                }
                return of([]);
            }),
            map(variants => variants.filter(notNullOrUndefined)),
        );
    }

    addProductVariant(product: ProductSelectorSearchQuery['search']['items'][number]) {
        const value = this.formControl.value as string[];
        this.formControl.setValue([...new Set([...value, product.productVariantId])]);
        this.formControl.markAsDirty();
    }

    removeProductVariant(id: string) {
        const value = this.formControl.value;
        this.formControl.setValue(value.map(this.getId).filter(_id => _id !== id));
        this.formControl.markAsDirty();
    }

    private getId(value: (typeof this.formControl.value)[number]) {
        return typeof value === 'string' ? value : value.id;
    }
}
