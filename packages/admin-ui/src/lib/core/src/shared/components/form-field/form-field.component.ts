import { Component, ContentChild, EventEmitter, Input, OnInit, Output } from '@angular/core';

import { FormFieldControlDirective } from './form-field-control.directive';

/**
 * A form field wrapper which handles the correct layout and validation error display for
 * a form control.
 */
@Component({
    selector: 'vdr-form-field',
    templateUrl: './form-field.component.html',
    styleUrls: ['./form-field.component.scss'],
    standalone: false,
})
export class FormFieldComponent implements OnInit {
    @Input() label: string;
    @Input() for: string;
    @Input() tooltip: string;
    /**
     * A map of error message codes (required, pattern etc.) to messages to display
     * when those errors are present.
     */
    @Input() errors: { [key: string]: string } = {};
    /**
     * If set to true, the input will be initially set to "readOnly", and an "edit" button
     * will be displayed which allows the field to be edited.
     */
    @Input() readOnlyToggle = false;
    @Output() readOnlyToggleChange = new EventEmitter<boolean>();
    @ContentChild(FormFieldControlDirective, { static: true }) formFieldControl: FormFieldControlDirective;
    isReadOnly = false;

    ngOnInit() {
        if (this.readOnlyToggle) {
            this.isReadOnly = true;
            this.setReadOnly(true);
        }
        this.isReadOnly = this.readOnlyToggle;
    }

    setReadOnly(value: boolean) {
        this.formFieldControl.setReadOnly(value);
        this.isReadOnly = value;
        this.readOnlyToggleChange.emit(value);
    }

    getErrorMessage(): string | undefined {
        if (!this.formFieldControl || !this.formFieldControl.formControlName) {
            return;
        }
        const errors =
            this.formFieldControl.formControlName.dirty && this.formFieldControl.formControlName.errors;
        if (errors) {
            for (const errorKey of Object.keys(errors)) {
                if (this.errors[errorKey]) {
                    return this.errors[errorKey];
                }
            }
        }
    }
}
