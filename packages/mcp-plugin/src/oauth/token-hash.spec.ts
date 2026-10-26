import { describe, expect, it } from 'vitest';

import { deriveHashKey, hashToken } from './token-hash';

const SECRET = 'test-token-secret-correct-horse-battery-staple';

describe('MCP token-hashing crypto util', () => {
    describe('deriveHashKey', () => {
        it('derives a stable 32-byte key from a secret', () => {
            const key = deriveHashKey(SECRET);
            expect(key).toBeInstanceOf(Buffer);
            expect(key.length).toBe(32);
        });

        it('produces different keys for different secrets', () => {
            const a = deriveHashKey(SECRET);
            const b = deriveHashKey('a-different-secret');
            expect(a.equals(b)).toBe(false);
        });
    });

    describe('hashToken', () => {
        it('is deterministic for same value + key (lookup-preserving)', () => {
            const key = deriveHashKey(SECRET);
            const a = hashToken('access-token-abc', key);
            const b = hashToken('access-token-abc', key);
            expect(a).toBe(b);
        });

        it('produces different hashes for different values', () => {
            const key = deriveHashKey(SECRET);
            expect(hashToken('token-a', key)).not.toBe(hashToken('token-b', key));
        });

        it('produces different hashes for the same value with different keys', () => {
            const key1 = deriveHashKey(SECRET);
            const key2 = deriveHashKey('a-different-secret');
            expect(hashToken('token-a', key1)).not.toBe(hashToken('token-a', key2));
        });
    });
});
