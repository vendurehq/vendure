import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * The EncryptionStrategy defines how the values of `secret` custom fields and config args are
 * encrypted before being stored in the database, and decrypted when loaded.
 *
 * The methods are synchronous because custom-field values are encrypted/decrypted inside a TypeORM
 * value transformer, which does not support asynchronous operation.
 *
 * :::info
 *
 * This is configured via the `systemOptions.encryptionStrategy` property of your VendureConfig.
 *
 * :::
 *
 * @since 3.8.0
 * @docsCategory configuration
 * @docsPage EncryptionStrategy
 * @docsWeight 0
 */
export interface EncryptionStrategy extends InjectableStrategy {
    /**
     * @description
     * Encrypts the given plaintext, returning a string which can be stored in the database.
     */
    encrypt(plaintext: string): string;

    /**
     * @description
     * Decrypts a value previously produced by `encrypt()`, returning the original plaintext.
     */
    decrypt(ciphertext: string): string;

    /**
     * @description
     * Returns `true` if the given value was produced by this strategy's `encrypt()` method. This is
     * used to detect secret values at the point they are returned from the API, without needing to
     * know which config arg or custom field they came from.
     */
    isEncrypted(value: string): boolean;

    /**
     * @description
     * Returns `true` if the strategy has everything it needs to encrypt and decrypt (e.g. a valid
     * key). This is used at bootstrap to fail fast if `secret` fields are configured but the
     * strategy is not usable.
     */
    isConfigured(): boolean;
}
