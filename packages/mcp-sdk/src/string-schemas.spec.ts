import { describe, expect, it } from 'vitest';

import { longText, shortText } from './string-schemas';

describe('text schemas', () => {
    it('caps shortText at 255 characters', () => {
        expect(shortText.safeParse('a'.repeat(255)).success).toBe(true);
        expect(shortText.safeParse('a'.repeat(256)).success).toBe(false);
    });

    it('caps longText at 10000 characters', () => {
        expect(longText.safeParse('a'.repeat(10000)).success).toBe(true);
        expect(longText.safeParse('a'.repeat(10001)).success).toBe(false);
    });
});
