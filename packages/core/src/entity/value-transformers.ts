import type { EncryptionStrategy } from '../config/system/encryption-strategy';
import { REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { ValueTransformer } from 'typeorm';

import { Logger } from '../config/logger/vendure-logger';

/**
 * Decimal types are returned as strings (e.g. "20.00") by some DBs, e.g. MySQL & Postgres
 */
export class DecimalTransformer implements ValueTransformer {
    to(value: any): any {
        return value;
    }

    from(value: any): any {
        return Number.parseFloat(value);
    }
}

/**
 * Encrypts a column value on write and decrypts it on read, using the configured
 * {@link EncryptionStrategy}. Used for custom fields marked as `secret`. The strategy is resolved
 * lazily via `getStrategy` because the transformer is created during entity registration, before
 * the strategy's `init()` (which derives the key) has run.
 */
export class EncryptedFieldTransformer implements ValueTransformer {
    constructor(private getStrategy: () => EncryptionStrategy | undefined) {}

    to(value: any): any {
        if (value == null || value === '') {
            return value;
        }
        return this.strategy().encrypt(String(value));
    }

    from(value: any): any {
        if (value == null || value === '') {
            return value;
        }
        const strategy = this.strategy();
        const stringValue = String(value);
        // Only values produced by encrypt() may be passed to decrypt(). A legacy plaintext value,
        // written before the field was marked secret, is returned unchanged.
        if (!strategy.isEncrypted(stringValue)) {
            return value;
        }
        try {
            return strategy.decrypt(stringValue);
        } catch (e: any) {
            // A single row whose value cannot be decrypted (corrupted ciphertext, a manual edit, or a
            // partial key change) must not fail the entire query. Log and fall back to the placeholder.
            Logger.error(`Failed to decrypt a secret custom field value: ${e.message as string}`);
            return REDACTED_SECRET_PLACEHOLDER;
        }
    }

    private strategy(): EncryptionStrategy {
        const strategy = this.getStrategy();
        if (!strategy) {
            throw new Error(
                'A `secret` custom field was used, but no EncryptionStrategy is configured in ' +
                    '`systemOptions.encryptionStrategy`.',
            );
        }
        return strategy;
    }
}
