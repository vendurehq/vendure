import { CurrencyService } from '@vendure/admin-ui/core';
import { CurrencyCode, LanguageCode } from '../../common/generated-types';

import { LocaleCurrencyPipe } from './locale-currency.pipe';

class MockCurrencyService extends CurrencyService {
    constructor(precision = 2) {
        super({
            serverConfig: {
                moneyStrategyPrecision: precision,
            },
        } as any);
    }
}

describe('LocaleCurrencyPipe', () => {
    it('GBP in English', () => {
        const pipe = new LocaleCurrencyPipe(new MockCurrencyService());
        expect(pipe.transform(1, CurrencyCode.GBP, LanguageCode.en)).toBe('£0.01');
        expect(pipe.transform(123, CurrencyCode.GBP, LanguageCode.en)).toBe('£1.23');
        expect(pipe.transform(4200000, CurrencyCode.GBP, LanguageCode.en)).toBe('£42,000.00');
    });

    it('EUR in German', () => {
        const pipe = new LocaleCurrencyPipe(new MockCurrencyService());
        expect(pipe.transform(1, CurrencyCode.EUR, LanguageCode.de)).toBe('0,01 €');
        expect(pipe.transform(123, CurrencyCode.EUR, LanguageCode.de)).toBe('1,23 €');
        expect(pipe.transform(4200000, CurrencyCode.EUR, LanguageCode.de)).toBe('42.000,00 €');
    });

    // https://github.com/vendurehq/vendure/issues/1768
    it('Custom currency code in English', () => {
        const pipe = new LocaleCurrencyPipe(new MockCurrencyService());
        const customCurrencyCode = 'FLTH';
        expect(pipe.transform(1, customCurrencyCode, LanguageCode.en)).toBe('0.01');
        expect(pipe.transform(123, customCurrencyCode, LanguageCode.en)).toBe('1.23');
        expect(pipe.transform(4200000, customCurrencyCode, LanguageCode.en)).toBe('42000.00');
    });

    it('with precision 3', async () => {
        const pipe = new LocaleCurrencyPipe(new MockCurrencyService(3));
        expect(pipe.transform(1, CurrencyCode.GBP, LanguageCode.en)).toBe('£0.001');
        expect(pipe.transform(123, CurrencyCode.GBP, LanguageCode.en)).toBe('£0.123');
        expect(pipe.transform(4200000, CurrencyCode.GBP, LanguageCode.en)).toBe('£4,200.000');
    });
});
