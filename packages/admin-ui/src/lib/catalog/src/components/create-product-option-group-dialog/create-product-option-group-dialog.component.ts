import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import {
    CreateProductOptionGroupInput,
    Dialog,
    findTranslation,
    GetProductVariantOptionsQuery,
    LanguageCode,
    ServerConfigService,
} from '@vendure/admin-ui/core';
import { normalizeString } from '@vendure/common/lib/normalize-string';

@Component({
    selector: 'vdr-create-product-option-group-dialog',
    templateUrl: './create-product-option-group-dialog.component.html',
    styleUrls: ['./create-product-option-group-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class CreateProductOptionGroupDialogComponent implements Dialog<CreateProductOptionGroupInput> {
    resolveWith: (result?: CreateProductOptionGroupInput) => void;
    languageCode: LanguageCode;
    form = this.formBuilder.group({
        name: ['', Validators.required],
        code: ['', Validators.required],
    });
    constructor(private formBuilder: FormBuilder) {}

    updateCode() {
        const nameControl = this.form.get('name');
        const codeControl = this.form.get('code');
        if (nameControl && codeControl && codeControl.pristine) {
            codeControl.setValue(normalizeString(`${nameControl.value}`, '-'));
        }
    }

    confirm() {
        const { name, code } = this.form.value;
        if (!name || !code) {
            return;
        }
        this.resolveWith({
            code,
            options: [],
            translations: [{ languageCode: this.languageCode, name }],
        });
    }

    cancel() {
        this.resolveWith();
    }
}
