import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormRecord, Validators } from '@angular/forms';
import {
    CreateProductVariantInput,
    CurrencyCode,
    Dialog,
    GetProductVariantOptionsQuery,
} from '@vendure/admin-ui/core';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';

@Component({
    selector: 'vdr-create-product-variant-dialog',
    templateUrl: './create-product-variant-dialog.component.html',
    styleUrls: ['./create-product-variant-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class CreateProductVariantDialogComponent implements Dialog<CreateProductVariantInput>, OnInit {
    resolveWith: (result?: CreateProductVariantInput) => void;
    product: NonNullable<GetProductVariantOptionsQuery['product']>;
    form = this.formBuilder.group({
        name: ['', Validators.required],
        sku: [''],
        price: [''],
        options: this.formBuilder.record<string>({}),
    });
    existingVariant: NonNullable<GetProductVariantOptionsQuery['product']>['variants'][number] | undefined;
    currencyCode: CurrencyCode;

    constructor(private formBuilder: FormBuilder) {}

    ngOnInit() {
        this.currencyCode = this.product.variants[0]?.currencyCode;
        for (const optionGroup of this.product.optionGroups) {
            (this.form.get('options') as FormRecord).addControl(
                optionGroup.code,
                new FormControl('', Validators.required),
            );
        }
        const optionsRecord = this.form.get('options') as FormRecord;
        optionsRecord.valueChanges.subscribe(value => {
            const nameControl = this.form.get('name');
            const allNull = Object.values(value).every(v => v == null);
            if (!allNull && value && nameControl && !nameControl.dirty) {
                const name = Object.entries(value)
                    .map(
                        ([groupCode, optionId]) =>
                            this.product.optionGroups
                                .find(og => og.code === groupCode)
                                ?.options.find(o => o.id === optionId)?.name,
                    )
                    .join(' ');
                nameControl.setValue(`${this.product.name} ${name}`);
            }
            const allSelected = Object.values(value).every(v => v != null);
            if (allSelected) {
                this.existingVariant = this.product.variants.find(v =>
                    Object.entries(value).every(
                        ([groupCode, optionId]) =>
                            v.options.find(o => o.groupId === this.getGroupIdFromCode(groupCode))?.id ===
                            optionId,
                    ),
                );
            }
        });
    }

    confirm() {
        const { name, sku, options, price } = this.form.value;
        if (!name || !options || price == null) {
            return;
        }

        const optionIds = Object.values(options).filter(notNullOrUndefined);
        this.resolveWith({
            productId: this.product.id,
            sku: sku || '',
            price: Number(price),
            optionIds,
            translations: [
                {
                    languageCode: this.product.languageCode,
                    name,
                },
            ],
        });
    }

    cancel() {
        this.resolveWith();
    }

    private getGroupCodeFromId(id: string): string {
        return this.product.optionGroups.find(og => og.id === id)?.code ?? '';
    }

    private getGroupIdFromCode(code: string): string {
        return this.product.optionGroups.find(og => og.code === code)?.id ?? '';
    }
}
