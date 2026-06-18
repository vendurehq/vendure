import { replaceLast } from './replace-last';

describe('replaceLast()', () => {
    it('leaves non-matching strings intact', () => {
        expect(replaceLast('foo bar baz', 'find', 'replace')).toBe('foo bar baz');
    });
    it('term is at start of target', () => {
        expect(replaceLast('find bar baz', 'find', 'replace')).toBe('replace bar baz');
    });
    it('term is at end of target', () => {
        expect(replaceLast('foo bar find', 'find', 'replace')).toBe('foo bar replace');
    });
    it('replaces last of 2 occurrences', () => {
        expect(replaceLast('foo find bar find', 'find', 'replace')).toBe('foo find bar replace');
    });
    it('replaces last of 2 consecutive occurrences', () => {
        expect(replaceLast('foo find find bar', 'find', 'replace')).toBe('foo find replace bar');
    });
    it('replaces last of 3 occurrences', () => {
        expect(replaceLast('find foo find bar find baz', 'find', 'replace')).toBe(
            'find foo find bar replace baz',
        );
    });
});
