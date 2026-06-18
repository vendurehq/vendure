import { Component, Injectable } from '@angular/core';
import { ComponentFixture, fakeAsync, TestBed, tick, waitForAsync } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { ServerConfigService } from '@vendure/admin-ui/core';
import { Type } from '@vendure/common/lib/shared-types';
import { of } from 'rxjs';

import { LanguageCode } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';
import { LocaleCurrencyNamePipe } from '../../pipes/locale-currency-name.pipe';
import { AffixedInputComponent } from '../affixed-input/affixed-input.component';

import { CurrencyInputComponent } from './currency-input.component';

class MockServerConfigService {
    serverConfig = {
        moneyStrategyPrecision: 2,
    };
}

describe('CurrencyInputComponent', () => {
    beforeEach(waitForAsync(() => {
        TestBed.configureTestingModule({
            imports: [FormsModule],
            providers: [
                { provide: DataService, useClass: MockDataService },
                { provide: ServerConfigService, useClass: MockServerConfigService },
            ],
            declarations: [
                TestControlValueAccessorComponent,
                TestSimpleComponent,
                CurrencyInputComponent,
                AffixedInputComponent,
                LocaleCurrencyNamePipe,
            ],
        }).compileComponents();
    }));

    it('should display the price as decimal with a simple binding', fakeAsync(() => {
        const fixture = createAndRunChangeDetection(TestSimpleComponent);
        const nativeInput = getNativeInput(fixture);
        expect(nativeInput.value).toBe('1.23');
    }));

    it('should display the price as decimal', fakeAsync(() => {
        const fixture = createAndRunChangeDetection(TestControlValueAccessorComponent);
        const nativeInput = getNativeInput(fixture);
        expect(nativeInput.value).toBe('1.23');
    }));

    it('should display 2 decimal places for multiples of 10', fakeAsync(() => {
        const fixture = createAndRunChangeDetection(TestControlValueAccessorComponent, 120);
        const nativeInput = getNativeInput(fixture);
        expect(nativeInput.value).toBe('1.20');
    }));

    it('should discard decimal places from input value', fakeAsync(() => {
        const fixture = createAndRunChangeDetection(TestControlValueAccessorComponent, 123.5);

        const nativeInput = getNativeInput(fixture);
        expect(nativeInput.value).toBe('1.23');
    }));

    it('should correctly round decimal value ', fakeAsync(() => {
        const fixture = createAndRunChangeDetection(TestControlValueAccessorComponent);
        const nativeInput = fixture.debugElement.query(By.css('input[type="number"]'));
        nativeInput.triggerEventHandler('input', { target: { value: 1.13 } });
        tick();
        fixture.detectChanges();
        expect(fixture.componentInstance.price).toBe(113);
    }));

    it('should update model with integer values for values of more than 2 decimal places', fakeAsync(() => {
        const fixture = createAndRunChangeDetection(TestControlValueAccessorComponent);
        const nativeInput = fixture.debugElement.query(By.css('input[type="number"]'));
        nativeInput.triggerEventHandler('input', { target: { value: 1.567 } });
        tick();
        fixture.detectChanges();
        expect(fixture.componentInstance.price).toBe(157);
    }));

    describe('currencies without minor units', () => {
        it('displays JPY without decimal places', fakeAsync(() => {
            MockDataService.language = LanguageCode.en;
            const fixture = createAndRunChangeDetection(TestSimpleComponent, 429900, 'JPY');
            const nativeInput = getNativeInput(fixture);
            expect(nativeInput.value).toBe('4299');
        }));

        it('increments JPY with a step of 1', fakeAsync(() => {
            MockDataService.language = LanguageCode.en;
            const fixture = createAndRunChangeDetection(TestSimpleComponent, 429900, 'JPY');
            const nativeInputDebugEl = fixture.debugElement.query(By.css('input[type="number"]'));

            const nativeInput = getNativeInput(fixture);
            expect(nativeInput.step).toBe('1');
        }));
    });

    describe('currencyCode display', () => {
        it('displays currency code in correct position (prefix)', fakeAsync(() => {
            MockDataService.language = LanguageCode.en;
            const fixture = createAndRunChangeDetection(TestSimpleComponent, 4299, 'GBP');
            const prefix = fixture.debugElement.query(By.css('.prefix'));
            const suffix = fixture.debugElement.query(By.css('.suffix'));
            expect(prefix.nativeElement.innerHTML).toBe('£');
            expect(suffix).toBeNull();
        }));

        it('displays currency code in correct position (suffix)', fakeAsync(() => {
            MockDataService.language = LanguageCode.fr;
            const fixture = createAndRunChangeDetection(TestSimpleComponent, 4299, 'GBP');
            const prefix = fixture.debugElement.query(By.css('.prefix'));
            const suffix = fixture.debugElement.query(By.css('.suffix'));
            expect(prefix).toBeNull();
            expect(suffix.nativeElement.innerHTML).toBe('£GB');
        }));
    });

    function createAndRunChangeDetection<T extends TestControlValueAccessorComponent | TestSimpleComponent>(
        component: Type<T>,
        priceValue = 123,
        currencyCode = '',
    ): ComponentFixture<T> {
        const fixture = TestBed.createComponent(component);
        if (fixture.componentInstance instanceof TestSimpleComponent && currencyCode) {
            fixture.componentInstance.currencyCode = currencyCode;
        }
        fixture.componentInstance.price = priceValue;
        fixture.detectChanges();
        tick();
        fixture.detectChanges();
        return fixture;
    }

    function getNativeInput(_fixture: ComponentFixture<TestControlValueAccessorComponent>): HTMLInputElement {
        return _fixture.debugElement.query(By.css('input[type="number"]')).nativeElement;
    }
});

@Component({
    selector: 'vdr-test-component',
    template: `
        <vdr-currency-input [(ngModel)]="price"></vdr-currency-input>
    `,
    standalone: false,
})
class TestControlValueAccessorComponent {
    price = 123;
}

@Component({
    selector: 'vdr-test-component',
    template: `
        <vdr-currency-input [value]="price" [currencyCode]="currencyCode"></vdr-currency-input>
    `,
    standalone: false,
})
class TestSimpleComponent {
    currencyCode = '';
    price = 123;
}

@Injectable()
class MockDataService {
    static language: LanguageCode = LanguageCode.en;
    client = {
        uiState() {
            return {
                mapStream(mapFn: any) {
                    return of(
                        mapFn({
                            uiState: {
                                language: MockDataService.language,
                            },
                        }),
                    );
                },
            };
        },
    };
}
