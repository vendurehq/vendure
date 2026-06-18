import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export function unicodePatternValidator(patternRe: RegExp): ValidatorFn {
    const unicodeRe = patternRe.unicode ? patternRe : new RegExp(patternRe, 'u');
    return (control: AbstractControl): ValidationErrors | null => {
        const valid = unicodeRe.test(control.value);
        return valid ? null : { pattern: { value: control.value } };
    };
}
