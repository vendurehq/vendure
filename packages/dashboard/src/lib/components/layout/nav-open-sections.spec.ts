import { describe, expect, it } from 'vitest';

import { openActiveSections, toggleOpenSection } from './nav-open-sections.js';

describe('toggleOpenSection', () => {
    it('closes the other sections when singleOpenSection is set', () => {
        expect(toggleOpenSection(new Set(['a']), 'b', true, true)).toEqual(new Set(['b']));
        expect(toggleOpenSection(new Set(['b']), 'b', false, true)).toEqual(new Set());
    });

    it('keeps the other sections open when singleOpenSection is not set', () => {
        expect(toggleOpenSection(new Set(['a']), 'b', true, false)).toEqual(new Set(['a', 'b']));
        expect(toggleOpenSection(new Set(['a', 'b']), 'b', false, false)).toEqual(new Set(['a']));
    });
});

describe('openActiveSections', () => {
    it('replaces the open sections with the active ones when singleOpenSection is set', () => {
        expect(openActiveSections(new Set(['a']), new Set(['b']), true)).toEqual(new Set(['b']));
    });

    it('adds the active sections to the open ones when singleOpenSection is not set', () => {
        expect(openActiveSections(new Set(['a']), new Set(['b']), false)).toEqual(new Set(['a', 'b']));
    });

    it('returns the same Set if nothing changes', () => {
        const open = new Set(['a', 'b']);
        expect(openActiveSections(open, new Set(['a', 'b']), true)).toBe(open);
        expect(openActiveSections(open, new Set(['a']), false)).toBe(open);
    });
});
