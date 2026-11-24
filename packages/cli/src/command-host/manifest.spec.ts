import { describe, expect, it } from 'vitest';

import { consentDigest } from './digest.js';
import { loadMergedManifest } from './manifest.js';

describe('consentDigest', () => {
    it('does not depend on the order of keys', () => {
        expect(consentDigest('c', { a: 1, b: { c: 2, d: 3 } })).toBe(
            consentDigest('c', { b: { d: 3, c: 2 }, a: 1 }),
        );
    });

    // A caller passes a digest from one process to another, so it must not depend on the locale.
    // Keys are ordered by code unit: "Z" before "a", and "é" last.
    it('gives the same digest in every process', () => {
        expect(consentDigest('revertMigration', { b: 1, a: 'é', Z: [2, { y: null, x: true }] })).toBe(
            '6a11e240efbb7810',
        );
    });

    it('differs when the preview or the consent differs', () => {
        expect(consentDigest('c', { a: 1 })).not.toBe(consentDigest('c', { a: 2 }));
        expect(consentDigest('c', { a: 1 })).not.toBe(consentDigest('d', { a: 1 }));
    });
});

describe('loadMergedManifest', () => {
    // `watch` compiles without writing the manifest, so a fresh `dist` from `watch` has none.
    it('builds the manifest from the declarations when the file is missing', async () => {
        const merged = await loadMergedManifest('/nonexistent/vendure-commands.json');
        expect(merged.map(command => command.path.join(' ')).sort()).toEqual([
            'add api-extension',
            'add codegen',
            'add dashboard',
            'add entity',
            'add job-queue',
            'add plugin',
            'add service',
            'commands',
            'devserver logs',
            'devserver start',
            'devserver status',
            'devserver stop',
            'devserver wait',
            'doctor',
            'mcp install',
            'migrate generate',
            'migrate revert',
            'migrate run',
            'store check',
        ]);
        expect(merged[0].source).toBe('@vendure/cli');
    });
});
