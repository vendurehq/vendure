import { describe, expect, it } from 'vitest';

import { parseAcceptLanguage } from './parse-accept-language';

/** A distinct, well-formed two-letter tag per index, for filling a header out to the cap. */
function distinctTag(index: number): string {
    return String.fromCharCode(97 + Math.floor(index / 26)) + String.fromCharCode(97 + (index % 26));
}

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

    it('reads the quality parameter case-insensitively', () => {
        expect(parseAcceptLanguage('de;Q=0.5,ja')).toEqual(['ja', 'de']);
    });

    it('tolerates whitespace around the separators', () => {
        expect(parseAcceptLanguage('de ; q=0.5 , ja')).toEqual(['ja', 'de']);
    });

    it('drops a tag whose quality does not parse', () => {
        expect(parseAcceptLanguage('de;q=,fr;q=abc,ja')).toEqual(['ja']);
    });

    it('does not let an out-of-range quality outrank an unweighted tag', () => {
        expect(parseAcceptLanguage('de;q=1.5,ja')).toEqual(['de', 'ja']);
        expect(parseAcceptLanguage('ja,de;q=1.5')).toEqual(['ja', 'de']);
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
        const tags = Array.from({ length: 30 }, (_, i) => distinctTag(i));
        expect(parseAcceptLanguage(tags.join(','))).toEqual(tags.slice(0, 10));
    });

    it('keeps the most preferred tags when it caps, not the first ones', () => {
        // The wanted tags sit at the end of the header, so keeping by position would drop them.
        const filler = Array.from({ length: 12 }, (_, i) => `${distinctTag(i)};q=0.1`);
        const result = parseAcceptLanguage([...filler, 'de;q=0.8', 'ja;q=0.9'].join(','));

        expect(result.slice(0, 2)).toEqual(['ja', 'de']);
        expect(result).toHaveLength(10);
    });

    it('accepts a tag of up to four subtags', () => {
        expect(parseAcceptLanguage('zh-cmn-Hans-CN')).toEqual([
            'zh_cmn_Hans_CN',
            'zh_cmn_Hans',
            'zh_cmn',
            'zh',
        ]);
    });

    it('rejects a tag with more subtags than that, rather than expanding it', () => {
        // Each subtag adds another entry to the chain walked for every string on every request.
        expect(parseAcceptLanguage('a' + '-bb'.repeat(200))).toEqual([]);
        expect(parseAcceptLanguage('en-Latn-GB-oxendict-x')).toEqual([]);
    });

    it('accepts the header as an array, as Express may supply it', () => {
        expect(parseAcceptLanguage(['ja', 'de;q=0.5'])).toEqual(['ja', 'de']);
    });
});
