import { ChangeDetectionStrategy, ChangeDetectorRef, Component, forwardRef, OnDestroy } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subscription } from 'rxjs';
import { CurrencyCode } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

@Component({
    selector: 'vdr-currency-code-selector',
    templateUrl: './currency-code-selector.component.html',
    styleUrls: ['./currency-code-selector.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => CurrencyCodeSelectorComponent),
            multi: true,
        },
    ],
    standalone: false,
})
export class CurrencyCodeSelectorComponent implements ControlValueAccessor, OnDestroy {
    currencyCodes = Object.values(CurrencyCode);
    private subscription: Subscription;
    private locale: string;
    protected value: string | undefined;
    onChangeFn: (value: any) => void;
    onTouchFn: (value: any) => void;

    searchCurrencyCodes = (term: string, item: CurrencyCode) => {
        const currencyCodeName = new Intl.DisplayNames([this.locale], {
            type: 'currency',
        }).of(item);
        return currencyCodeName?.toLowerCase().includes(term.toLowerCase());
    };

    constructor(dataService?: DataService, changeDetectorRef?: ChangeDetectorRef) {
        if (dataService && changeDetectorRef) {
            this.subscription = dataService.client
                .uiState()
                .mapStream(data => data.uiState)
                .subscribe(({ language, locale }) => {
                    this.locale = language.replace(/_/g, '-');
                    if (locale) {
                        this.locale += `-${locale}`;
                    }
                    changeDetectorRef.markForCheck();
                });
        }
    }

    writeValue(obj: any): void {
        this.value = obj;
    }
    registerOnChange(fn: any): void {
        this.onChangeFn = fn;
    }
    registerOnTouched(fn: any): void {
        this.onTouchFn = fn;
    }

    ngOnDestroy(): void {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }
}
