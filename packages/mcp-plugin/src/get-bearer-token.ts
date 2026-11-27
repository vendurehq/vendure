/**
 * The token of an `Authorization: Bearer <token>` header: everything after the scheme and the
 * whitespace that follows it, with surrounding whitespace trimmed. Undefined when the header is
 * missing, names another scheme, or has no whitespace between the scheme and the token, as in
 * `Bearerabc`. The MCP transport and the local-trust Admin API middleware both read the header
 * this way.
 */
export function getBearerToken(header: string | string[] | undefined): string | undefined {
    const value = (Array.isArray(header) ? header[0] : header)?.trim();
    if (!value || value.slice(0, 6).toLowerCase() !== 'bearer') {
        return undefined;
    }
    const afterScheme = value.slice(6);
    if (!/^\s/.test(afterScheme)) {
        return undefined;
    }
    const token = afterScheme.trim();
    return token || undefined;
}
