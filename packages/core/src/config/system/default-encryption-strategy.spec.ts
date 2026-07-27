import { describe, expect, it } from 'vitest';

import { DefaultEncryptionStrategy } from './default-encryption-strategy';

function configured(secret = 'test-secret') {
    const strategy = new DefaultEncryptionStrategy({ secret });
    strategy.init();
    return strategy;
}

describe('DefaultEncryptionStrategy', () => {
    it('round-trips a value', () => {
        const strategy = configured();
        const encrypted = strategy.encrypt('hello world');
        expect(encrypted).toMatch(/^enc:v1:/);
        expect(encrypted).not.toContain('hello world');
        expect(strategy.decrypt(encrypted)).toBe('hello world');
    });

    it('produces distinct ciphertext per call (random IV)', () => {
        const strategy = configured();
        expect(strategy.encrypt('x')).not.toBe(strategy.encrypt('x'));
    });

    it('passes through legacy plaintext without the enc:v1: prefix', () => {
        const strategy = configured();
        expect(strategy.decrypt('legacy-plaintext')).toBe('legacy-plaintext');
    });

    it('reports whether it is configured', () => {
        const unconfigured = new DefaultEncryptionStrategy({ secret: undefined });
        unconfigured.init();
        // Note: relies on VENDURE_ENCRYPTION_KEY not being set in the test environment.
        expect(unconfigured.isConfigured()).toBe(process.env.VENDURE_ENCRYPTION_KEY != null);
        expect(configured().isConfigured()).toBe(true);
    });

    it('throws on decrypt with a mismatched key', () => {
        const a = configured('key-a');
        const b = configured('key-b');
        const encrypted = a.encrypt('secret-value');
        expect(() => b.decrypt(encrypted)).toThrow();
    });
});
