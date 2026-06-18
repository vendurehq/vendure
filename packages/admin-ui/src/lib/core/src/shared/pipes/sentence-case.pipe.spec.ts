import { SentenceCasePipe } from './sentence-case.pipe';

describe('SentenceCasePipe:', () => {
    let sentenceCasePipe: SentenceCasePipe;
    beforeEach(() => (sentenceCasePipe = new SentenceCasePipe()));

    it('works with multiple words', () => {
        expect(sentenceCasePipe.transform('foo bar baz')).toBe('Foo bar baz');
        expect(sentenceCasePipe.transform('fOo BAR baZ')).toBe('Foo bar baz');
    });

    it('splits camelCase', () => {
        expect(sentenceCasePipe.transform('fooBarBaz')).toBe('Foo bar baz');
        expect(sentenceCasePipe.transform('FooBarbaz')).toBe('Foo barbaz');
    });

    it('unexpected input', () => {
        expect(sentenceCasePipe.transform(null as any)).toBe(null);
        expect(sentenceCasePipe.transform(undefined as any)).toBe(undefined);
        expect(sentenceCasePipe.transform([] as any)).toEqual([]);
        expect(sentenceCasePipe.transform(123 as any)).toEqual(123);
    });
});
