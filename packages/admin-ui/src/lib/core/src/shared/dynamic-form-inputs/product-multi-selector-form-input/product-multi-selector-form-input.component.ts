import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnInit } from '@angular/core';
import { FormControl, UntypedFormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent } from '../../../common/component-registry-types';
import { DataService } from '../../../data/providers/data.service';
import { ModalService } from '../../../providers/modal/modal.service';
import { ProductMultiSelectorDialogComponent } from '../../components/product-multi-selector-dialog/product-multi-selector-dialog.component';

@Component({
    selector: 'vdr-product-multi-selector-form-input',
    templateUrl: './product-multi-selector-form-input.component.html',
    styleUrls: ['./product-multi-selector-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ProductMultiSelectorFormInputComponent implements OnInit, FormInputComponent {
    @Input() config: DefaultFormComponentConfig<'product-multi-form-input'>;
    @Input() formControl: FormControl<string[] | Array<{ id: string }>>;
    @Input() readonly: boolean;
    mode: 'product' | 'variant' = 'product';
    readonly isListInput = true;
    static readonly id: DefaultFormComponentId = 'product-multi-form-input';

    constructor(
        private modalService: ModalService,
        private dataService: DataService,
        private changeDetector: ChangeDetectorRef,
    ) {}

    ngOnInit() {
        this.mode = this.config.ui?.selectionMode ?? 'product';
    }

    select() {
        this.modalService
            .fromComponent(ProductMultiSelectorDialogComponent, {
                size: 'xl',
                locals: {
                    mode: this.mode,
                    initialSelectionIds: this.formControl.value.map(item =>
                        typeof item === 'string' ? item : item.id,
                    ),
                },
            })
            .subscribe(selection => {
                if (selection) {
                    this.formControl.setValue(
                        selection.map(item =>
                            this.mode === 'product' ? item.productId : item.productVariantId,
                        ),
                    );
                    this.formControl.markAsDirty();
                    this.changeDetector.markForCheck();
                }
            });
    }
}
