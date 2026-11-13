import { describe, expect, it } from 'vitest';

import { deriveBaseUrl } from './derive-base-url.js';

describe('deriveBaseUrl', () => {
    const origin = 'http://localhost:5174';

    it('derives the base from the bundle entry file', () => {
        expect(deriveBaseUrl(`${origin}/admin/dashboard/dist/bundle/main.js`, '/')).toBe('/admin/dashboard');
    });

    // #4719 — in bundle mode the derivation code is split into a hashed chunk,
    // so the module URL points at dist/bundle/chunks/main-<hash>.js, not main.js.
    it('derives the base from a code-split bundle chunk', () => {
        expect(deriveBaseUrl(`${origin}/admin/dashboard/dist/bundle/chunks/main-abc123.js`, '/')).toBe(
            '/admin/dashboard',
        );
    });

    it('derives the base from the source entry (dev / source-shipping mode)', () => {
        expect(deriveBaseUrl(`${origin}/admin/dashboard/src/app/main.tsx`, '/')).toBe('/admin/dashboard');
    });

    it('returns undefined when mounted at the root (bundle)', () => {
        expect(deriveBaseUrl(`${origin}/dist/bundle/main.js`, '/')).toBeUndefined();
    });

    it('returns undefined when mounted at the root (source)', () => {
        expect(deriveBaseUrl(`${origin}/src/app/main.tsx`, '/')).toBeUndefined();
    });

    // Greedy match must anchor on the LAST marker occurrence, so a deployment
    // base that itself contains a marker segment is not truncated.
    it('does not truncate when the deployment base contains a marker segment', () => {
        expect(deriveBaseUrl(`${origin}/vendor/src/app/my-admin/dist/bundle/chunks/main-abc.js`, '/')).toBe(
            '/vendor/src/app/my-admin',
        );
    });

    it('strips a trailing slash from the fallback base', () => {
        expect(deriveBaseUrl('', '/admin/dashboard/')).toBe('/admin/dashboard');
    });

    it('falls back to the provided base when the module URL yields no marker', () => {
        expect(deriveBaseUrl(`${origin}/something/else/entry.js`, '/admin/dashboard')).toBe(
            '/admin/dashboard',
        );
    });

    it('returns undefined for an invalid module URL with no usable fallback', () => {
        expect(deriveBaseUrl('not a url', '/')).toBeUndefined();
    });
});
