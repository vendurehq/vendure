import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { CreateFacetValueInput, Dialog, LanguageCode } from '@vendure/admin-ui/core';

import { normalizeString } from '@vendure/common/lib/normalize-string';

@Component({
    selector: 'vdr-create-facet-value-dialog',
    templateUrl: './create-facet-value-dialog.component.html',
    styleUrls: ['./create-facet-value-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class CreateFacetValueDialogComponent implements Dialog<CreateFacetValueInput> {
    resolveWith: (result?: CreateFacetValueInput) => void;
    languageCode: LanguageCode;
    form = this.formBuilder.group({
        name: ['', Validators.required],
        code: ['', Validators.required],
    });
    facetId: string;
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
            facetId: this.facetId,
            code,
            translations: [{ languageCode: this.languageCode, name }],
        });
    }

    cancel() {
        this.resolveWith();
    }
}
