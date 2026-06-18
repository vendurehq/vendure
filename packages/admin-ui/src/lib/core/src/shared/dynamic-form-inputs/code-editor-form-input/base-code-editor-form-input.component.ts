import { AfterViewInit, ChangeDetectorRef, Directive, ElementRef, ViewChild } from '@angular/core';
import { UntypedFormControl, ValidatorFn } from '@angular/forms';
import { DefaultFormComponentConfig } from '@vendure/common/lib/shared-types';
import { CodeJar } from 'codejar';

import { FormInputComponent } from '../../../common/component-registry-types';

export interface CodeEditorConfig {
    validator: ValidatorFn;
    getErrorMessage: (content: string) => string | undefined;
    highlight: (content: string, errorPos: number | undefined) => string;
}

@Directive()
export abstract class BaseCodeEditorFormInputComponent implements FormInputComponent, AfterViewInit {
    readonly: boolean;
    formControl: UntypedFormControl;
    config: DefaultFormComponentConfig<'json-editor-form-input'>;
    isValid = true;
    errorMessage: string | undefined;
    @ViewChild('editor') private editorElementRef: ElementRef<HTMLDivElement>;
    jar: CodeJar;
    private highlight: CodeEditorConfig['highlight'];
    private getErrorMessage: CodeEditorConfig['getErrorMessage'];

    protected constructor(protected changeDetector: ChangeDetectorRef) {}

    get height() {
        return this.config.ui?.height || this.config.height;
    }

    configure(config: CodeEditorConfig) {
        this.formControl.addValidators(config.validator);
        this.highlight = config.highlight;
        this.getErrorMessage = config.getErrorMessage;
    }

    ngAfterViewInit() {
        let lastVal = '';
        const highlight = (editor: HTMLElement) => {
            const code = editor.textContent ?? '';
            if (code === lastVal) {
                return;
            }
            lastVal = code;
            this.errorMessage = this.getErrorMessage(code);
            this.changeDetector.markForCheck();
            editor.innerHTML = this.highlight(code, this.getErrorPos(this.errorMessage));
        };
        this.jar = CodeJar(this.editorElementRef.nativeElement, highlight);
        let isFirstUpdate = true;
        this.jar.onUpdate(value => {
            if (isFirstUpdate) {
                isFirstUpdate = false;
                return;
            }
            this.formControl.setValue(value);
            this.formControl.markAsDirty();
            this.isValid = this.formControl.valid;
        });
        this.jar.updateCode(this.formControl.value);

        if (this.readonly) {
            this.editorElementRef.nativeElement.contentEditable = 'false';
        }
    }

    protected getErrorPos(errorMessage: string | undefined): number | undefined {
        if (!errorMessage) {
            return;
        }
        const matches = errorMessage.match(/at position (\d+)/);
        const pos = matches?.[1];
        return pos != null ? +pos : undefined;
    }
}
