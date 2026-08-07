import { afterEach, describe, expect, it, vi } from 'vitest';

import { DefaultEncryptionStrategy } from '../../../config/system/default-encryption-strategy';

import { EncryptionKeyVerifierService } from './encryption-key-verifier.service';

const SETTINGS_KEY = 'vendure.encryption.keyCheck';

function strategy(secret: string | undefined) {
    const s = new DefaultEncryptionStrategy({ secret });
    s.init();
    return s;
}

/**
 * Builds a verifier wired to an in-memory settings store shared across "boots", so that a value
 * written by one instance is seen by the next.
 */
function createVerifier(
    store: Map<string, string>,
    encryptionStrategy: DefaultEncryptionStrategy | undefined,
    opts: { getThrows?: boolean; dbInitialized?: boolean } = {},
) {
    const settingsStoreService = {
        register: vi.fn(),
        get: vi.fn(async (_ctx: any, key: string) => {
            if (opts.getThrows) {
                throw new Error('settings_store table does not exist');
            }
            return store.get(key);
        }),
        set: vi.fn(async (_ctx: any, key: string, value: string) => {
            store.set(key, value);
            return { key, result: true };
        }),
    };
    const connection = { rawConnection: { isInitialized: opts.dbInitialized ?? true } };
    const configService = { systemOptions: { encryptionStrategy } };
    const service = new EncryptionKeyVerifierService(
        settingsStoreService as any,
        connection as any,
        configService as any,
    );
    return { service, settingsStoreService };
}

describe('EncryptionKeyVerifierService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('writes a key check on first boot, then passes on a subsequent boot with the same key', async () => {
        const store = new Map<string, string>();

        const first = createVerifier(store, strategy('key-a'));
        await expect(first.service.onApplicationBootstrap()).resolves.not.toThrow();
        expect(store.get(SETTINGS_KEY)).toMatch(/^enc:v1:/);

        const second = createVerifier(store, strategy('key-a'));
        await expect(second.service.onApplicationBootstrap()).resolves.not.toThrow();
        // The stored check is not rewritten once present.
        expect(second.settingsStoreService.set).not.toHaveBeenCalled();
    });

    it('throws on a subsequent boot with a different key', async () => {
        const store = new Map<string, string>();
        await createVerifier(store, strategy('key-a')).service.onApplicationBootstrap();

        const wrongKey = createVerifier(store, strategy('key-b'));
        await expect(wrongKey.service.onApplicationBootstrap()).rejects.toThrow(
            /encryption key does not match/,
        );
    });

    it('does nothing when no key is configured', async () => {
        const store = new Map<string, string>();
        const { service, settingsStoreService } = createVerifier(store, strategy(undefined));
        await expect(service.onApplicationBootstrap()).resolves.not.toThrow();
        expect(settingsStoreService.set).not.toHaveBeenCalled();
        expect(store.size).toBe(0);
    });

    it('skips verification (does not throw) when the settings store cannot be read', async () => {
        const store = new Map<string, string>();
        // Pre-seed a check written under a different key, which would mismatch if it could be read.
        store.set(SETTINGS_KEY, strategy('key-a').encrypt('vendure-encryption-key-check'));
        const { service } = createVerifier(store, strategy('key-b'), { getThrows: true });
        await expect(service.onApplicationBootstrap()).resolves.not.toThrow();
    });
});
