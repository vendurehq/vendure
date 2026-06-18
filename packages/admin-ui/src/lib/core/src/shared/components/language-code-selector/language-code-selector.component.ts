import {
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    forwardRef,
    Input,
    OnDestroy,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { Subscription } from 'rxjs';
import { DataService } from '../../../data/providers/data.service';

@Component({
    selector: 'vdr-language-code-selector',
    templateUrl: './language-code-selector.component.html',
    styleUrls: ['./language-code-selector.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => LanguageCodeSelectorComponent),
            multi: true,
        },
    ],
    standalone: false,
})
export class LanguageCodeSelectorComponent implements ControlValueAccessor, OnDestroy {
    @Input() languageCodes: string[];
    private subscription: Subscription;
    private locale: string;
    protected value: string | undefined;
    onChangeFn: (value: any) => void;
    onTouchFn: (value: any) => void;

    searchLanguageCodes = (term: string, item: string) => {
        let languageCodeName = item;
        const languagePart = item.split('_')[0];
        try {
            languageCodeName =
                new Intl.DisplayNames([this.locale], {
                    type: 'language',
                }).of(languagePart) ?? item;
        } catch (e) {
            // ignore
        }
        return languageCodeName?.toLowerCase().includes(term.toLowerCase());
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
