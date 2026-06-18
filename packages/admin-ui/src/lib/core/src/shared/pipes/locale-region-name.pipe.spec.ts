import { LocaleRegionNamePipe } from './locale-region-name.pipe';

describe('LocaleRegionNamePipe', () => {
    const pipe = new LocaleRegionNamePipe();
    it('returns correct region names for various locales', () => {
        expect(pipe.transform('GB', 'en')).toBe('United Kingdom');
        expect(pipe.transform('AT', 'en')).toBe('Austria');
        expect(pipe.transform('AT', 'de')).toBe('Österreich');
        expect(pipe.transform('CN', 'zh')).toBe('中国');
    });

    it('returns region for unknown codes', () => {
        expect(pipe.transform('xx')).toBe('xx');
    });

    it('returns empty string for empty input', () => {
        expect(pipe.transform('')).toBe('');
        expect(pipe.transform(null)).toBe('');
        expect(pipe.transform(undefined)).toBe('');
    });

    it('returns warning for invalid input', () => {
        expect(pipe.transform({} as any)).toBe('Invalid region code "[object Object]"');
        expect(pipe.transform(false as any)).toBe('Invalid region code "false"');
    });

    it('returns input value for invalid string input', () => {
        expect(pipe.transform('foo.bar')).toBe('foo.bar');
    });
});
