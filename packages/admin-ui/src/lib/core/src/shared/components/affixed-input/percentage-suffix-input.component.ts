import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * A form input control which displays a number input with a percentage sign suffix.
 */
@Component({
    selector: 'vdr-percentage-suffix-input',
    styles: [
        `
            :host {
                padding: 0;
            }
        `,
    ],
    template: `
        <vdr-affixed-input suffix="%">
            <input
                type="number"
                step="1"
                [value]="_value"
                [disabled]="disabled"
                [readonly]="readonly"
                (input)="onInput($event.target.value)"
                (focus)="onTouch()"
            />
        </vdr-affixed-input>
    `,
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: PercentageSuffixInputComponent,
            multi: true,
        },
    ],
    standalone: false,
})
export class PercentageSuffixInputComponent implements ControlValueAccessor, OnChanges {
    @Input() disabled = false;
    @Input() readonly = false;
    @Input() value: number;
    onChange: (val: any) => void;
    onTouch: () => void;
    _value: number;

    ngOnChanges(changes: SimpleChanges) {
        if ('value' in changes) {
            this.writeValue(changes['value'].currentValue);
        }
    }

    registerOnChange(fn: any) {
        this.onChange = fn;
    }

    registerOnTouched(fn: any) {
        this.onTouch = fn;
    }

    setDisabledState(isDisabled: boolean) {
        this.disabled = isDisabled;
    }

    onInput(value: string | number) {
        this.onChange(value);
    }

    writeValue(value: any): void {
        const numericValue = +value;
        if (!Number.isNaN(numericValue)) {
            this._value = numericValue;
        }
    }
}
