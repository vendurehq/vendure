import { describe, expect, it } from 'vitest';

import { parseSince } from './log-reader.js';

const now = new Date('2026-11-22T10:00:00.000Z');

describe('parseSince()', () => {
    it('reads a duration back from now', () => {
        expect(parseSince('30s', now)?.toISOString()).toBe('2026-11-22T09:59:30.000Z');
        expect(parseSince('15m', now)?.toISOString()).toBe('2026-11-22T09:45:00.000Z');
        expect(parseSince('2h', now)?.toISOString()).toBe('2026-11-22T08:00:00.000Z');
        expect(parseSince('1d', now)?.toISOString()).toBe('2026-11-21T10:00:00.000Z');
    });

    it('reads an ISO 8601 instant', () => {
        expect(parseSince('2026-11-20T10:00:00Z', now)?.toISOString()).toBe('2026-11-20T10:00:00.000Z');
    });

    it('refuses a bare number and text it cannot read', () => {
        expect(parseSince('15', now)).toBeUndefined();
        expect(parseSince('soon', now)).toBeUndefined();
    });
});
