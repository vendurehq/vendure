import { describe, expect, it } from 'vitest';

import { EncryptionStrategy } from '../config/system/encryption-strategy';

import { EncryptedFieldTransformer } from './value-transformers';

/**
 * A strategy that throws if asked to decrypt anything not produced by encrypt(), modelling a custom
 * strategy that honours the interface contract strictly (decrypt only handles ciphertext).
 */
class StrictStrategy implements EncryptionStrategy {
    encrypt(plaintext: string) {
        return `enc:${plaintext}`;
    }
    decrypt(ciphertext: string) {
        if (!this.isEncrypted(ciphertext)) {
            throw new Error('decrypt() called on a non-ciphertext value');
        }
        return ciphertext.slice('enc:'.length);
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

    it('decrypts ciphertext on read', () => {
        expect(transformer.from('enc:secret')).toBe('secret');
    });

    it('returns legacy plaintext unchanged without calling decrypt', () => {
        expect(transformer.from('legacy-plaintext')).toBe('legacy-plaintext');
    });

    it('passes null and empty through', () => {
        expect(transformer.from(null)).toBe(null);
        expect(transformer.from('')).toBe('');
    });
});
