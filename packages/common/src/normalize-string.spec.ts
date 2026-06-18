import { describe, expect, it } from 'vitest';

import { normalizeString } from './normalize-string';

describe('normalizeString()', () => {
    it('lowercases the string', () => {
        expect(normalizeString('FOO')).toBe('foo');
        expect(normalizeString('Foo Bar')).toBe('foo bar');
    });

    it('replaces diacritical marks with plain equivalents', () => {
        expect(normalizeString('thé')).toBe('the');
        expect(normalizeString('curaçao')).toBe('curacao');
        expect(normalizeString('dấu hỏi')).toBe('dau hoi');
        expect(normalizeString('el niño')).toBe('el nino');
        expect(normalizeString('genkō yōshi')).toBe('genko yoshi');
        expect(normalizeString('việt nam')).toBe('viet nam');
    });

    it('replaces spaces with the spaceReplacer', () => {
        expect(normalizeString('old man', '_')).toBe('old_man');
        expect(normalizeString('old  man', '_')).toBe('old_man');
    });

    it('strips non-alphanumeric characters', () => {
        expect(normalizeString('hi!!!')).toBe('hi');
        expect(normalizeString('who? me?')).toBe('who me');
        expect(normalizeString('!"£$%^&*()+[]{};:@#~?/,|\\><`¬\'=©®™')).toBe('');
    });

    it('allows a subset of non-alphanumeric characters to pass through', () => {
        expect(normalizeString('-_.')).toBe('-_.');
    });

    // https://github.com/vendurehq/vendure/issues/679
    it('replaces single quotation marks', () => {
        expect(normalizeString('Capture d’écran')).toBe('capture decran');
        expect(normalizeString('Capture d‘écran')).toBe('capture decran');
    });

    it('replaces eszett with double-s digraph', () => {
        expect(normalizeString('KONGREẞ im Straßennamen')).toBe('kongress im strassennamen');
    });

    // works for German language, might not work for e.g. Finnish language
    it('replaces combining diaeresis with e', () => {
        expect(normalizeString('Ja quäkt Schwyz Pöbel vor Gmünd')).toBe('ja quaekt schwyz poebel vor gmuend');
    });

    it('contracts multiple sequential replacers to a single replacer', () => {
        expect(normalizeString('foo - bar', '-')).toBe('foo-bar');
        expect(normalizeString('foo--bar', '-')).toBe('foo-bar');
        expect(normalizeString('foo - bar', '_')).toBe('foo_-_bar');
        expect(normalizeString('foo _ bar', '_')).toBe('foo_bar');
    });
});
