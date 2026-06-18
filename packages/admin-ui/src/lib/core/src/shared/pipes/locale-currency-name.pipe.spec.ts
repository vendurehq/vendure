import { LocaleCurrencyNamePipe } from './locale-currency-name.pipe';

describe('LocaleCurrencyNamePipe', () => {
    const pipe = new LocaleCurrencyNamePipe();
    it('full output', () => {
        expect(pipe.transform('usd')).toBe('US Dollar ($)');
        expect(pipe.transform('gbp')).toBe('British Pound (£)');
        expect(pipe.transform('CNY')).toBe('Chinese Yuan (CN¥)');
    });

    it('name output', () => {
        expect(pipe.transform('usd', 'name')).toBe('US Dollar');
        expect(pipe.transform('gbp', 'name')).toBe('British Pound');
        expect(pipe.transform('CNY', 'name')).toBe('Chinese Yuan');
    });

    it('symbol output', () => {
        expect(pipe.transform('usd', 'symbol')).toBe('$');
        expect(pipe.transform('gbp', 'symbol')).toBe('£');
        expect(pipe.transform('CNY', 'symbol')).toBe('CN¥');
    });

    it('uses locale', () => {
        expect(pipe.transform('usd', 'symbol', 'fr')).toBe('$US');
        expect(pipe.transform('usd', 'name', 'de')).toBe('US-Dollar');
    });

    it('returns code for unknown codes', () => {
        expect(pipe.transform('zzz')).toBe('zzz (ZZZ)');
    });

    it('returns empty string for empty input', () => {
        expect(pipe.transform('')).toBe('');
        expect(pipe.transform(null)).toBe('');
        expect(pipe.transform(undefined)).toBe('');
    });

    it('returns warning for invalid input', () => {
        expect(pipe.transform({} as any)).toBe('Invalid currencyCode "[object Object]"');
        expect(pipe.transform(false as any)).toBe('Invalid currencyCode "false"');
    });
});
