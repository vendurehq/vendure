/**
 * True for a hostname that means "this machine". Accepts the bracketed IPv6 form that
 * `URL.hostname` returns (`[::1]`).
 *
 * This sits in a module of its own, with no imports, so the dashboard bundle can use the same
 * rule as the server: `oauth-utils.ts` depends on NestJS and `node:crypto`, neither of which
 * can be loaded in a browser.
 */
export function isLoopbackHostname(hostname: string): boolean {
    const bare = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}
