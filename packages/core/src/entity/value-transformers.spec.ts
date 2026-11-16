import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { describe, expect, it } from 'vitest';

import { EncryptionStrategy } from '../config/system/encryption-strategy';

import { EncryptedFieldTransformer } from './value-transformers';

/**
 * A strategy that throws if asked to decrypt anything not produced by encrypt(), modelling a custom
 * strategy that honours the interface contract strictly (decrypt only handles ciphertext). A value of
 * `enc:corrupt` models ciphertext that cannot be decrypted (e.g. corrupted or wrong-key data).
 */
class StrictStrategy implements EncryptionStrategy {
    encrypt(plaintext: string) {
        return `enc:${plaintext}`;
    }
    decrypt(ciphertext: string) {
        if (!this.isEncrypted(ciphertext)) {
            throw new Error('decrypt() called on a non-ciphertext value');
        }
        const payload = ciphertext.slice('enc:'.length);
        if (payload === 'corrupt') {
            throw new Error('cannot decrypt');
        }
        return payload;
    }
    isEncrypted(value: string) {
        return value.startsWith('enc:');
    }
    isConfigured() {
        return true;
    }
}

describe('EncryptedFieldTransformer', () => {
    const transformer = new EncryptedFieldTransformer(() => new StrictStrategy());

    it('encrypts on write', () => {
        expect(transformer.to('secret')).toBe('enc:secret');
    });

    it('passes null and empty through on write without encrypting', () => {
        expect(transformer.to(null)).toBe(null);
        expect(transformer.to('')).toBe('');
    });

    it('decrypts ciphertext on read', () => {
        expect(transformer.from('enc:secret')).toBe('secret');
    });

    it('returns legacy plaintext unchanged without calling decrypt', () => {
        expect(transformer.from('legacy-plaintext')).toBe('legacy-plaintext');
    });

    it('returns the placeholder (not throwing) when a single value cannot be decrypted', () => {
        expect(transformer.from('enc:corrupt')).toBe(REDACTED_SECRET_PLACEHOLDER);
    });

    it('passes null and empty through on read', () => {
        expect(transformer.from(null)).toBe(null);
        expect(transformer.from('')).toBe('');
    });

    it('throws when no EncryptionStrategy is configured', () => {
        const unconfigured = new EncryptedFieldTransformer(() => undefined);
        expect(() => unconfigured.to('secret')).toThrow(/no EncryptionStrategy is configured/);
        expect(() => unconfigured.from('enc:secret')).toThrow(/no EncryptionStrategy is configured/);
    });
});
