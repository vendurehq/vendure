import { describe, expect, it } from 'vitest';

import {
    compactText,
    getJsonSummary,
    shouldUseListCountSummary,
} from './configurable-operation-arg-summary.js';

describe('shouldUseListCountSummary', () => {
    it('uses a count when a scalar component is wrapped for a list field', () => {
        expect(shouldUseListCountSummary(true, [100, 200], undefined)).toBe(true);
    });

    it('keeps semantic summaries for list-aware components', () => {
        expect(shouldUseListCountSummary(true, ['1', '2'], true)).toBe(false);
        expect(shouldUseListCountSummary(true, ['1', '2'], 'dynamic')).toBe(false);
    });
});

describe('compactText', () => {
    it('strips HTML and normalizes whitespace', () => {
        expect(
            compactText(
                '<style>.hidden { display: none }</style><p>Hello <strong>world</strong></p><p>Next</p>',
            ).full,
        ).toBe('Hello world Next');
    });

    it('truncates long content for sentence chips', () => {
        const result = compactText('a'.repeat(100));
        expect(result.compact).toHaveLength(80);
        expect(result.compact.endsWith('\u2026')).toBe(true);
    });
});

describe('getJsonSummary', () => {
    it('summarizes arrays and objects', () => {
        expect(getJsonSummary('[1, 2, 3]')).toEqual({ type: 'items', count: 3 });
        expect(getJsonSummary('{"one": 1, "two": 2}')).toEqual({ type: 'properties', count: 2 });
    });

    it('uses compact text for invalid JSON', () => {
        expect(getJsonSummary('not json')).toEqual({ type: 'text', value: 'not json' });
    });
});
