import { describe, expect, it } from 'vitest';

import { truncateToUtf8Bytes } from './constrain-indexed-text';

describe('truncateToUtf8Bytes()', () => {
    const maxBytes = 10;

    function expectValidTruncation(input: string, result: string) {
        expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(maxBytes);
        expect(input.startsWith(result)).toBe(true);
        expect(result).not.toContain('�');
    }

    it('returns input under the limit unchanged', () => {
        expect(truncateToUtf8Bytes('abc', maxBytes)).toBe('abc');
    });

    it('returns input exactly at the limit unchanged', () => {
        const input = 'a'.repeat(8) + 'é';
        expect(Buffer.byteLength(input, 'utf8')).toBe(maxBytes);
        expect(truncateToUtf8Bytes(input, maxBytes)).toBe(input);
    });

    for (const [label, char] of [
        ['2-byte', 'é'],
        ['3-byte', '€'],
        ['4-byte', '😀'],
    ]) {
        it(`drops a ${label} char which straddles the limit`, () => {
            const input = 'a'.repeat(maxBytes - 1) + char + 'b';
            const result = truncateToUtf8Bytes(input, maxBytes);
            expectValidTruncation(input, result);
            expect(result).toBe('a'.repeat(maxBytes - 1));
        });

        it(`truncates a run of ${label} chars`, () => {
            const input = char.repeat(maxBytes);
            const result = truncateToUtf8Bytes(input, maxBytes);
            expectValidTruncation(input, result);
            const charBytes = Buffer.byteLength(char, 'utf8');
            expect(result).toBe(char.repeat(Math.floor(maxBytes / charBytes)));
        });
    }
});
