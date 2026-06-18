import { Component, ElementRef, EventEmitter, OnInit, Output, QueryList, ViewChildren } from '@angular/core';
import { AbstractControl, FormBuilder, FormControl, FormGroup } from '@angular/forms';
import {
    CurrencyCode,
    DataService,
    GetStockLocationListDocument,
    GetStockLocationListQuery,
    ItemOf,
} from '@vendure/admin-ui/core';
import { generateAllCombinations } from '@vendure/common/lib/shared-utils';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { OptionValueInputComponent } from '../option-value-input/option-value-input.component';

const DEFAULT_VARIANT_CODE = '__DEFAULT_VARIANT__';
export type CreateVariantValues = {
    optionValues: string[];
    enabled: boolean;
    sku: string;
    price: number;
    stock: number;
};
export type CreateProductVariantsConfig = {
    groups: Array<{ name: string; values: string[] }>;
    variants: CreateVariantValues[];
    stockLocationId: string;
};

@Component({
    selector: 'vdr-generate-product-variants',
    templateUrl: './generate-product-variants.component.html',
    styleUrls: ['./generate-product-variants.component.scss'],
    standalone: false
})
export class GenerateProductVariantsComponent implements OnInit {
    @Output() variantsChange = new EventEmitter<CreateProductVariantsConfig>();
    @ViewChildren('optionGroupName', { read: ElementRef }) groupNameInputs: QueryList<ElementRef>;
    optionGroups: Array<{ name: string; values: Array<{ name: string; locked: boolean }> }> = [];
    currencyCode: CurrencyCode;
    variants: Array<{ id: string; values: string[] }>;
    variantFormValues: {
        [id: string]: FormGroup<{
            optionValues: FormControl<string[]>;
            enabled: FormControl<boolean>;
            price: FormControl<number>;
            sku: FormControl<string>;
            stock: FormControl<number>;
        }>;
    } = {};
    stockLocations$: Observable<Array<ItemOf<GetStockLocationListQuery, 'stockLocations'>>>;
    selectedStockLocationId: string | null = null;
    constructor(
        private dataService: DataService,
        private formBuilder: FormBuilder,
    ) {}

    ngOnInit() {
        this.dataService.settings.getActiveChannel().single$.subscribe(data => {
            this.currencyCode = data.activeChannel.defaultCurrencyCode;
        });
        this.stockLocations$ = this.dataService
            .query(GetStockLocationListDocument, {
                options: {
                    take: 999,
                },
            })
            .refetchOnChannelChange()
            .mapStream(({ stockLocations }) => stockLocations.items)
            .pipe(
                tap(items => {
                    if (items.length) {
                        this.selectedStockLocationId = items[0].id;
                        this.onFormChange();
                    }
                }),
            );

        this.generateVariants();
    }

    addOption() {
        this.optionGroups.push({ name: '', values: [] });
        const index = this.optionGroups.length - 1;
        setTimeout(() => {
            const input = this.groupNameInputs.get(index)?.nativeElement;
            input?.focus();
        });
    }

    removeOption(name: string) {
        this.optionGroups = this.optionGroups.filter(g => g.name !== name);
        this.generateVariants();
    }

    generateVariants() {
        const totalValuesCount = this.optionGroups.reduce((sum, group) => sum + group.values.length, 0);
        const groups = totalValuesCount
            ? this.optionGroups.map(g => g.values.map(v => v.name))
            : [[DEFAULT_VARIANT_CODE]];
        this.variants = generateAllCombinations(groups).map(values => ({ id: values.join('|'), values }));

        this.variants.forEach((variant, index) => {
            if (!this.variantFormValues[variant.id]) {
                const formGroup = this.formBuilder.nonNullable.group({
                    optionValues: [variant.values],
                    enabled: true as boolean,
                    price: this.copyFromDefault(variant.id, 'price', 0),
                    sku: this.copyFromDefault(variant.id, 'sku', ''),
                    stock: this.copyFromDefault(variant.id, 'stock', 0),
                });
                formGroup.valueChanges.subscribe(() => this.onFormChange());
                if (index === 0) {
                    formGroup.get('price')?.valueChanges.subscribe(value => {
                        this.copyValuesToPristine('price', formGroup.get('price'));
                    });
                    formGroup.get('sku')?.valueChanges.subscribe(value => {
                        this.copyValuesToPristine('sku', formGroup.get('sku'));
                    });
                    formGroup.get('stock')?.valueChanges.subscribe(value => {
                        this.copyValuesToPristine('stock', formGroup.get('stock'));
                    });
                }
                this.variantFormValues[variant.id] = formGroup;
            }
        });
        this.onFormChange();
    }

    trackByFn(index: number, variant: { name: string; values: string[] }) {
        return variant.values.join('|');
    }

    handleEnter(event: KeyboardEvent, optionValueInputComponent: OptionValueInputComponent) {
        event.preventDefault();
        event.stopPropagation();
        optionValueInputComponent.focus();
    }

    copyValuesToPristine(field: 'price' | 'sku' | 'stock', formControl: AbstractControl | null) {
        if (!formControl) {
            return;
        }
        Object.values(this.variantFormValues).forEach(formGroup => {
            const correspondingFormControl = formGroup.get(field) as FormControl;
            if (correspondingFormControl && correspondingFormControl.pristine) {
                correspondingFormControl.setValue(formControl.value, { emitEvent: false });
            }
        });
    }

    onFormChange() {
        const variantsToCreate = this.variants
            .map(v => this.variantFormValues[v.id].value as CreateVariantValues)
            .filter(v => v.enabled);
        this.variantsChange.emit({
            groups: this.optionGroups.map(og => ({ name: og.name, values: og.values.map(v => v.name) })),
            variants: variantsToCreate,
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            stockLocationId: this.selectedStockLocationId!,
        });
    }

    private copyFromDefault<T extends keyof CreateVariantValues>(
        variantId: string,
        prop: T,
        value: CreateVariantValues[T],
    ): CreateVariantValues[T] {
        return variantId !== DEFAULT_VARIANT_CODE
            ? (this.variantFormValues[DEFAULT_VARIANT_CODE].get(prop)?.value as CreateVariantValues[T])
            : value;
    }
}
