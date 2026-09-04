import { createHmac, scryptSync } from 'node:crypto';

const KEY_LENGTH = 32;
const HASH_KEY_SALT = 'mcp-oauth-hash-key-v1';

/** Call once at startup and reuse the key; rotating the secret makes every stored OAuth credential unresolvable. */
export function deriveHashKey(secret: string): Buffer {
    return scryptSync(secret, HASH_KEY_SALT, KEY_LENGTH);
}

/** Deterministic and one-way, so tokens can be stored at rest and still found by an exact-match lookup, without the plaintext ever being recoverable. */
export function hashToken(value: string, hashKey: Buffer): string {
    return createHmac('sha256', hashKey).update(value).digest('base64url');
}

/** The `lookup:` namespace keeps these hashes separate from any other keyed hashes introduced in the future. */
export function hashLookupToken(value: string, hashKey: Buffer): string {
    return hashToken(`lookup:${value}`, hashKey);
}
