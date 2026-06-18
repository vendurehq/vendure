import { Directive, ElementRef, Optional } from '@angular/core';
import { NgControl } from '@angular/forms';

type InputElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/* eslint-disable @angular-eslint/directive-selector */
@Directive({
    selector: 'input, textarea, select, vdr-currency-input',
    standalone: false,
})
export class FormFieldControlDirective {
    constructor(
        private elementRef: ElementRef<InputElement>,
        @Optional() public formControlName: NgControl,
    ) {}

    get valid(): boolean {
        return !!this.formControlName && !!this.formControlName.valid;
    }

    get touched(): boolean {
        return !!this.formControlName && !!this.formControlName.touched;
    }

    setReadOnly(value: boolean) {
        const input = this.elementRef.nativeElement;
        if (isSelectElement(input)) {
            input.disabled = value;
        } else {
            input.readOnly = value;
        }
    }
}

function isSelectElement(value: InputElement): value is HTMLSelectElement {
    return value.hasOwnProperty('selectedIndex');
}
