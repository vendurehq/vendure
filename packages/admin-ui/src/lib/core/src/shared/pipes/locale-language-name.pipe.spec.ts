import { LocaleLanguageNamePipe } from './locale-language-name.pipe';

describe('LocaleLanguageNamePipe', () => {
    const pipe = new LocaleLanguageNamePipe();
    it('returns correct language names for various locales', () => {
        expect(pipe.transform('en', 'en')).toBe('English');
        expect(pipe.transform('de', 'en')).toBe('German');
        expect(pipe.transform('de', 'de')).toBe('Deutsch');
        expect(pipe.transform('is', 'fr')).toBe('islandais');
        expect(pipe.transform('es', 'zh_Hans')).toBe('西班牙语');
        expect(pipe.transform('bs', 'zh_Hant')).toBe('波士尼亞文');
        expect(pipe.transform('da', 'pt_BR')).toBe('dinamarquês');
        expect(pipe.transform('zh_Hant', 'en')).toBe('Traditional Chinese');
    });

    it('return correct names for language plus region', () => {
        expect(pipe.transform('en-MY', 'en')).toBe('English (Malaysia)');
        expect(pipe.transform('de-AT', 'de')).toBe('Österreichisches Deutsch');
        expect(pipe.transform('zh_Hant-CN', 'en')).toBe('Chinese (Traditional, China)');
    });

    it('returns code for unknown codes', () => {
        expect(pipe.transform('xx')).toBe('xx');
    });

    it('returns empty string for empty input', () => {
        expect(pipe.transform('')).toBe('');
        expect(pipe.transform(null)).toBe('');
        expect(pipe.transform(undefined)).toBe('');
    });

    it('returns warning for invalid input', () => {
        expect(pipe.transform({} as any)).toBe('Invalid language code "[object Object]"');
        expect(pipe.transform(false as any)).toBe('Invalid language code "false"');
    });

    it('returns input value for invalid string input', () => {
        expect(pipe.transform('foo.bar')).toBe('foo.bar');
    });
});
