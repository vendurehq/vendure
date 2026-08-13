import { createHmac, scryptSync } from 'node:crypto';

const KEY_LENGTH = 32;
const HASH_KEY_SALT = 'mcp-oauth-hash-key-v1';

/**
 * Derives a stable 32-byte HMAC key from the operator-supplied `oauth.tokenSecret`
 * via scrypt. Call once at startup and reuse the returned key for all
 * {@link hashToken} calls. Rotating the secret makes every stored OAuth credential
 * unresolvable, since the same plaintext then hashes to a different value.
 */
export function deriveHashKey(secret: string): Buffer {
    return scryptSync(secret, HASH_KEY_SALT, KEY_LENGTH);
}

/**
 * Deterministically hashes a lookup token (access/refresh token, authorization
 * code, request token) so the value can be stored at rest and still resolved via
 * a unique-index `where: { token }` lookup. Uses keyed HMAC-SHA256: deterministic
 * (preserves index lookups) and one-way (the plaintext is never recovered).
 */
export function hashToken(value: string, hashKey: Buffer): string {
    return createHmac('sha256', hashKey).update(value).digest('base64url');
}

/**
 * Hashes a plaintext OAuth credential for indexed storage and lookup. The `lookup:` namespace
 * keeps these values separate from any other keyed hashes introduced in the future.
 */
export function hashLookupToken(value: string, hashKey: Buffer): string {
    return hashToken(`lookup:${value}`, hashKey);
}
