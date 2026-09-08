import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

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
 * A fixed salt for key derivation. A per-database random salt would additionally defeat cross-install
 * precomputation, but deriving the key synchronously at bootstrap (as required by the synchronous
 * transformer) rules out loading a stored salt here; the primary protection against brute-force is
 * scrypt's per-guess cost combined with a high-entropy secret.
 */
const KEY_DERIVATION_SALT = 'vendure:default-encryption-strategy';
const RECOMMENDED_SECRET_LENGTH = 24;

/**
 * @description
 * The default {@link EncryptionStrategy}, which uses AES-256-GCM. The encryption key is derived from
 * the `secret` passed to the strategy. The secret is not read from the environment by the strategy
 * itself; instead you provide it explicitly in your config, typically from an environment variable:
 *
 * @example
 * ```ts
 * systemOptions: {
 *     encryptionStrategy: new DefaultEncryptionStrategy({ secret: process.env.VENDURE_ENCRYPTION_KEY }),
 * }
 * ```
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
        if (this.options.secret) {
            if (this.options.secret.length < RECOMMENDED_SECRET_LENGTH) {
                Logger.warn(
                    `The encryption secret is shorter than the recommended ${RECOMMENDED_SECRET_LENGTH} ` +
                        'characters. Use a long, high-entropy random value: a short or guessable secret ' +
                        'can be brute-forced offline if the encrypted data or key check is obtained.',
                );
            }
            // Derive a 32-byte AES-256 key from the secret using scrypt, a memory-hard KDF, so that
            // brute-forcing a weak secret is expensive per guess (a plain hash would be cheap).
            this.key = scryptSync(this.options.secret, KEY_DERIVATION_SALT, 32);
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
        if (ivPart == null || authTagPart == null || dataPart == null) {
            throw new Error(
                'The value is not a well-formed ciphertext (expected `enc:v1:<iv>:<authTag>:<data>`).',
            );
        }
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
                'The DefaultEncryptionStrategy has no encryption key configured. Pass a `secret` to ' +
                    'the strategy, e.g. `new DefaultEncryptionStrategy({ secret: process.env.VENDURE_ENCRYPTION_KEY })`.',
            );
        }
        return this.key;
    }
}
