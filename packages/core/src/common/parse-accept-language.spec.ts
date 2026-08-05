import { describe, expect, it } from 'vitest';

import { parseAcceptLanguage } from './parse-accept-language';

describe('parseAcceptLanguage()', () => {
    it('returns an empty list when there is no header', () => {
        expect(parseAcceptLanguage(undefined)).toEqual([]);
        expect(parseAcceptLanguage('')).toEqual([]);
    });

    it('parses a single tag', () => {
        expect(parseAcceptLanguage('ja')).toEqual(['ja']);
    });

    it('orders by quality, highest first', () => {
        expect(parseAcceptLanguage('de;q=0.7,ja;q=0.9,fr;q=0.8')).toEqual(['ja', 'fr', 'de']);
    });

    it('treats a missing quality as 1', () => {
        expect(parseAcceptLanguage('de;q=0.9,ja')).toEqual(['ja', 'de']);
    });

    it('keeps the header order for equal qualities', () => {
        expect(parseAcceptLanguage('de,ja,fr')).toEqual(['de', 'ja', 'fr']);
    });

    it('drops a tag the client rejected with q=0', () => {
        expect(parseAcceptLanguage('ja,de;q=0')).toEqual(['ja']);
    });

    it('truncates a tag subtag by subtag', () => {
        expect(parseAcceptLanguage('zh-Hans-CN')).toEqual(['zh_Hans_CN', 'zh_Hans', 'zh']);
    });

    it('normalises casing to match the LanguageCode convention', () => {
        expect(parseAcceptLanguage('pt-br')).toEqual(['pt_BR', 'pt']);
        expect(parseAcceptLanguage('ZH-hans')).toEqual(['zh_Hans', 'zh']);
    });

    it('does not repeat a code reachable from more than one tag', () => {
        expect(parseAcceptLanguage('en-GB,en-US')).toEqual(['en_GB', 'en', 'en_US']);
    });

    it('ignores the wildcard', () => {
        expect(parseAcceptLanguage('ja,*')).toEqual(['ja']);
    });

    it('ignores anything which is not a language tag', () => {
        expect(parseAcceptLanguage("ja,'; DROP TABLE product;--")).toEqual(['ja']);
        expect(parseAcceptLanguage('../../etc/passwd')).toEqual([]);
    });

    it('caps the number of tags it will honour', () => {
        const header = Array.from(
            { length: 30 },
            (_, i) => String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + (i % 26)),
        ).join(',');
        expect(parseAcceptLanguage(header)).toHaveLength(10);
    });

    it('accepts the header as an array, as Express may supply it', () => {
        expect(parseAcceptLanguage(['ja', 'de;q=0.5'])).toEqual(['ja', 'de']);
    });
});
