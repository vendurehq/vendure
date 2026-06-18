import { Directive, Input, Optional } from '@angular/core';
import { FormControl, FormControlDirective, FormControlName } from '@angular/forms';

/**
 * Allows declarative binding to the "disabled" property of a reactive form
 * control.
 */
@Directive({
    selector: '[vdrDisabled]',
    standalone: false,
})
export class DisabledDirective {
    @Input('vdrDisabled') set disabled(val: boolean) {
        const formControl = this.formControlName?.control ?? this.formControl?.form;
        if (!formControl) {
            return;
        }
        if (!!val === false) {
            formControl.enable({ emitEvent: false });
        } else {
            formControl.disable({ emitEvent: false });
        }
    }

    constructor(
        @Optional() private formControlName: FormControlName,
        @Optional() private formControl: FormControlDirective,
    ) {}
}
