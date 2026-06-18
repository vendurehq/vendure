import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent } from '../../../common/component-registry-types';

import { BaseCodeEditorFormInputComponent } from './base-code-editor-form-input.component';

export function jsonValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
        const error: ValidationErrors = { jsonInvalid: true };

        try {
            JSON.parse(control.value);
        } catch (e: any) {
            control.setErrors(error);
            return error;
        }

        control.setErrors(null);
        return null;
    };
}

/**
 * @description
 * A JSON editor input with syntax highlighting and error detection. Works well
 * with `text` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-json-editor-form-input',
    templateUrl: './json-editor-form-input.component.html',
    styleUrls: ['./json-editor-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class JsonEditorFormInputComponent
    extends BaseCodeEditorFormInputComponent
    implements FormInputComponent, AfterViewInit, OnInit
{
    static readonly id: DefaultFormComponentId = 'json-editor-form-input';

    constructor(protected changeDetector: ChangeDetectorRef) {
        super(changeDetector);
    }

    ngOnInit() {
        this.configure({
            validator: jsonValidator,
            highlight: (json: string, errorPos: number | undefined) => {
                json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                let hasMarkedError = false;
                return json.replace(
                    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
                    (match, ...args) => {
                        let cls = 'number';
                        if (/^"/.test(match)) {
                            if (/:$/.test(match)) {
                                cls = 'key';
                            } else {
                                cls = 'string';
                            }
                        } else if (/true|false/.test(match)) {
                            cls = 'boolean';
                        } else if (/null/.test(match)) {
                            cls = 'null';
                        }
                        let errorClass = '';
                        if (errorPos && !hasMarkedError) {
                            const length = args[0].length;
                            const offset = args[4];
                            if (errorPos <= length + offset) {
                                errorClass = 'je-error';
                                hasMarkedError = true;
                            }
                        }
                        return '<span class="je-' + cls + ' ' + errorClass + '">' + match + '</span>';
                    },
                );
            },
            getErrorMessage: (json: string): string | undefined => {
                try {
                    JSON.parse(json);
                } catch (e: any) {
                    return e.message;
                }
                return;
            },
        });
    }
}
