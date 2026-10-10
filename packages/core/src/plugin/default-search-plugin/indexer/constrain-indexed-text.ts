/**
 * Postgres B-tree index rows are limited to 2704 bytes, and the `productName`, `productVariantName`
 * and `description` columns of the SearchIndexItem have B-tree indexes on Postgres. We truncate below
 * that limit to leave room for the index tuple overhead.
 * https://github.com/vendurehq/vendure/issues/745
 * https://github.com/vendurehq/vendure/issues/5367
 */
export const POSTGRES_MAX_INDEXED_TEXT_BYTES = 2600;

/**
 * Truncates the string to at most `maxBytes` UTF-8 bytes without splitting a multibyte character.
 */
export function truncateToUtf8Bytes(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, 'utf8') <= maxBytes) {
        return value;
    }
    const bytes = Buffer.from(value, 'utf8');
    let end = maxBytes;
    // Continuation bytes match 10xxxxxx. Step back until `end` is at the first byte of a character.
    while (end > 0 && (bytes[end] & 0xc0) === 0x80) {
        end--;
    }
    return bytes.subarray(0, end).toString('utf8');
}
