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

    it('detects its own ciphertext via isEncrypted', () => {
        const strategy = configured();
        expect(strategy.isEncrypted(strategy.encrypt('hello'))).toBe(true);
        expect(strategy.isEncrypted('legacy-plaintext')).toBe(false);
        expect(strategy.isEncrypted('')).toBe(false);
    });

    it('reports whether it is configured', () => {
        const unconfigured = new DefaultEncryptionStrategy({ secret: undefined });
        unconfigured.init();
        expect(unconfigured.isConfigured()).toBe(false);
        expect(configured().isConfigured()).toBe(true);
    });

    it('does not read the secret from the environment', () => {
        process.env.VENDURE_ENCRYPTION_KEY = 'from-env-should-be-ignored';
        try {
            const strategy = new DefaultEncryptionStrategy({ secret: undefined });
            strategy.init();
            expect(strategy.isConfigured()).toBe(false);
        } finally {
            delete process.env.VENDURE_ENCRYPTION_KEY;
        }
    });

    it('throws on decrypt with a mismatched key', () => {
        const a = configured('key-a');
        const b = configured('key-b');
        const encrypted = a.encrypt('secret-value');
        expect(() => b.decrypt(encrypted)).toThrow();
    });
});
