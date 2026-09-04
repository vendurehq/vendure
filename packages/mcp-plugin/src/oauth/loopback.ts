/** Kept import-free so the dashboard bundle can reuse this check too; `oauth-utils.ts` pulls in NestJS and `node:crypto`, which can't load in a browser. */
export function isLoopbackHostname(hostname: string): boolean {
    const bare = hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1';
}
