/**
 * The codes of the {@link VendureStartupError}s which core throws. They are stable across releases and
 * listed in `vendure-codes.snapshot.json`.
 */
export const CORE_STARTUP_ERROR_CODES = {
    invalidCustomFields: 'core.config.invalid-custom-fields',
    incompatiblePlugin: 'core.config.incompatible-plugin',
    invalidSecretConfigArg: 'core.config.invalid-secret-config-arg',
    missingEncryptionStrategy: 'core.config.missing-encryption-strategy',
    reservedRefundDestinationCode: 'core.config.reserved-refund-destination-code',
    duplicateRefundDestinationCode: 'core.config.duplicate-refund-destination-code',
} as const;
