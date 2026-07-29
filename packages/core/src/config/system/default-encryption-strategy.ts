import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

import { Logger } from '../logger/vendure-logger';

import { EncryptionStrategy } from './encryption-strategy';

/**
 * The prefix identifying a value encrypted by this strategy, including a format version so that the
 * encryption scheme can be evolved in future without ambiguity.
 */
const CIPHERTEXT_PREFIX = 'enc:v1:';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * @description
 * The default {@link EncryptionStrategy}, which uses AES-256-GCM. The encryption key is derived from
 * a secret provided either via the `secret` option or the `VENDURE_ENCRYPTION_KEY` environment
 * variable.
 *
 * The secret must remain stable across restarts and deployments: if it changes, existing encrypted
 * data can no longer be decrypted.
 *
 * @since 3.8.0
 * @docsCategory configuration
 * @docsPage EncryptionStrategy
 */
export class DefaultEncryptionStrategy implements EncryptionStrategy {
    private key: Buffer | undefined;

    constructor(private options: { secret?: string } = {}) {}

    init() {
        const secret = this.options.secret ?? process.env.VENDURE_ENCRYPTION_KEY;
        if (secret) {
            // Derive a fixed-length 32-byte key from the provided secret, so that any-length
            // secrets are supported while satisfying AES-256's key-length requirement.
            this.key = createHash('sha256').update(secret, 'utf8').digest();
        }
    }

    isConfigured(): boolean {
        return this.key != null;
    }

    isEncrypted(value: string): boolean {
        return value.startsWith(CIPHERTEXT_PREFIX);
    }

    encrypt(plaintext: string): string {
        const key = this.assertKey();
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv(ALGORITHM, key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return `${CIPHERTEXT_PREFIX}${iv.toString('base64url')}:${authTag.toString(
            'base64url',
        )}:${encrypted.toString('base64url')}`;
    }

    decrypt(ciphertext: string): string {
        if (!ciphertext.startsWith(CIPHERTEXT_PREFIX)) {
            // Value predates encryption being enabled on this field (or was written by a raw SQL
            // insert). It is returned unchanged so existing data is not broken; it will be encrypted
            // the next time the entity is saved.
            return ciphertext;
        }
        const key = this.assertKey();
        const [ivPart, authTagPart, dataPart] = ciphertext.slice(CIPHERTEXT_PREFIX.length).split(':');
        try {
            const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, 'base64url'));
            decipher.setAuthTag(Buffer.from(authTagPart, 'base64url'));
            return Buffer.concat([
                decipher.update(Buffer.from(dataPart, 'base64url')),
                decipher.final(),
            ]).toString('utf8');
        } catch (e: any) {
            Logger.error(
                'Failed to decrypt a secret value. This usually means the configured encryption key ' +
                    'does not match the key used to encrypt the existing data.',
            );
            throw e;
        }
    }

    private assertKey(): Buffer {
        if (!this.key) {
            throw new Error(
                'The DefaultEncryptionStrategy has no encryption key configured. Set the ' +
                    '`VENDURE_ENCRYPTION_KEY` environment variable, or pass a `secret` to the strategy.',
            );
        }
        return this.key;
    }
}
