import { AfterViewInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { DefaultFormComponentId } from '@vendure/common/lib/shared-types';

import { FormInputComponent } from '../../../common/component-registry-types';

import { BaseCodeEditorFormInputComponent } from './base-code-editor-form-input.component';

function htmlValidator(): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => null;
}

const HTML_TAG_RE = /<\/?[^>]+>?/g;

/**
 * @description
 * A JSON editor input with syntax highlighting and error detection. Works well
 * with `text` type fields.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-html-editor-form-input',
    templateUrl: './html-editor-form-input.component.html',
    styleUrls: ['./html-editor-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class HtmlEditorFormInputComponent
    extends BaseCodeEditorFormInputComponent
    implements FormInputComponent, AfterViewInit, OnInit
{
    static readonly id: DefaultFormComponentId = 'html-editor-form-input';

    constructor(protected changeDetector: ChangeDetectorRef) {
        super(changeDetector);
    }

    ngOnInit() {
        this.configure({
            validator: htmlValidator,
            highlight: (html: string, errorPos: number | undefined) => {
                let hasMarkedError = false;
                return html.replace(HTML_TAG_RE, (match, ...args) => {
                    let errorClass = '';
                    if (errorPos && !hasMarkedError) {
                        const length = args[0].length;
                        const offset = args[4];
                        if (errorPos <= length + offset) {
                            errorClass = 'je-error';
                            hasMarkedError = true;
                        }
                    }
                    return (
                        '<span class="he-tag' +
                        ' ' +
                        errorClass +
                        '">' +
                        this.encodeHtmlChars(match).replace(
                            /([a-zA-Z0-9-]+=)(["'][^'"]*["'])/g,
                            (_match, ..._args) => `${_args[0]}<span class="he-attr">${_args[1]}</span>`,
                        ) +
                        '</span>'
                    );
                });
            },
            getErrorMessage: (json: string): string | undefined => undefined,
        });
    }

    private encodeHtmlChars(html: string): string {
        return html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
