import { Injectable, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Permission } from '@vendure/common/lib/generated-types';

import { RequestContext } from '../../../api/common/request-context';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { SettingsStoreScopes } from '../../../config/settings-store/settings-store-types';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { SettingsStoreService } from '../settings-store/settings-store.service';

/**
 * A fixed, known plaintext which is encrypted with the active key and stored the first time an
 * encryption key is used against a given database. On every subsequent bootstrap it is decrypted and
 * compared: if it no longer matches, the configured key differs from the key that encrypted the
 * database's data (e.g. the key was changed, or a database dump was restored into an environment with
 * a different `VENDURE_ENCRYPTION_KEY`). This turns that situation into a single clear error at
 * startup rather than scattered decryption failures at runtime.
 */
const KEY_CHECK_PLAINTEXT = 'vendure-encryption-key-check';
const SETTINGS_NAMESPACE = 'vendure.encryption';
const SETTINGS_FIELD = 'keyCheck';
const SETTINGS_KEY = `${SETTINGS_NAMESPACE}.${SETTINGS_FIELD}`;

@Injectable()
export class EncryptionKeyVerifierService implements OnModuleInit, OnApplicationBootstrap {
    constructor(
        private settingsStoreService: SettingsStoreService,
        private connection: TransactionalConnection,
        private configService: ConfigService,
    ) {}

    onModuleInit() {
        this.settingsStoreService.register({
            namespace: SETTINGS_NAMESPACE,
            fields: [
                {
                    name: SETTINGS_FIELD,
                    scope: SettingsStoreScopes.global,
                    readonly: true,
                    // Restrict read access to the SuperAdmin. Without this, the settings store
                    // exposes a registered field to any authenticated user, which would hand out
                    // this key-check value (a known plaintext encrypted with the active key) as an
                    // offline brute-force oracle for the encryption secret. The SuperAdmin already
                    // has full access to decrypted secrets, so this is not a new capability for them.
                    requiresPermission: Permission.SuperAdmin,
                },
            ],
        });
    }

    async onApplicationBootstrap() {
        await this.verifyEncryptionKey();
    }

    /**
     * The "no key configured" case is handled separately by the ConfigModule, which fails fast if a
     * `secret` field or arg is used without a usable key. Here we only guard the "wrong key" case,
     * which requires a usable key to be present. This check is purely additive: if the settings store
     * cannot be read (e.g. migrations have not yet run), we skip verification rather than block
     * startup — only a value that is present but fails to decrypt is treated as a mismatch.
     */
    private async verifyEncryptionKey() {
        const { encryptionStrategy } = this.configService.systemOptions;
        if (!encryptionStrategy?.isConfigured() || !this.connection.rawConnection?.isInitialized) {
            return;
        }
        const ctx = RequestContext.empty();
        let stored: string | undefined;
        try {
            stored = await this.settingsStoreService.get<string>(ctx, SETTINGS_KEY);
        } catch (e: any) {
            Logger.warn(
                'Could not read the encryption key check from the settings store; skipping key ' +
                    `verification. ${e.message as string}`,
            );
            return;
        }
        if (stored == null) {
            // First use of an encryption key against this database: bind it to the current key.
            // The settings store value type does not accept a bare string, hence the cast (as in
            // the InstallationIdCollector).
            const result = await this.settingsStoreService.set(
                ctx,
                SETTINGS_KEY,
                encryptionStrategy.encrypt(KEY_CHECK_PLAINTEXT) as any,
            );
            if (!result.result) {
                // `set` catches internally and returns a result rather than throwing, so without this
                // a failed write would silently leave the wrong-key guard un-armed on later boots.
                Logger.warn(
                    'Could not persist the encryption key check; the key-mismatch guard will not be ' +
                        `active until it succeeds. ${result.error ?? ''}`,
                );
            }
            return;
        }
        let decrypted: string | undefined;
        try {
            decrypted = encryptionStrategy.decrypt(stored);
        } catch {
            this.throwKeyMismatch();
        }
        if (decrypted !== KEY_CHECK_PLAINTEXT) {
            this.throwKeyMismatch();
        }
    }

    private throwKeyMismatch(): never {
        throw new Error(
            '[Vendure] The configured encryption key does not match the key used to encrypt this ' +
                "database's existing data. This usually means the `VENDURE_ENCRYPTION_KEY` (or the " +
                'DefaultEncryptionStrategy `secret`) was changed, or a database was restored from an ' +
                'environment that used a different key. Encrypted data can only be read with the ' +
                'original key, and key rotation is not currently supported. If you have intentionally ' +
                'changed the key and there is no encrypted data to preserve, delete the ' +
                `"${SETTINGS_KEY}" entry from the settings store to re-bind the database to the new key.`,
        );
    }
}
