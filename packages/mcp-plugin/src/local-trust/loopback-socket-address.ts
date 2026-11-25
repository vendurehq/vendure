import { isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = '::ffff:';

/**
 * True when a socket's remote address is a loopback address: `127.0.0.0/8`, `::1`, or an IPv4
 * loopback address mapped into IPv6 (`::ffff:127.x.x.x`), which is how a dual-stack listener
 * reports a local IPv4 client.
 *
 * This checks the socket's address, never a header. `isLoopbackHostname` in `shared/loopback.ts`
 * is the check for `Host` header names. It is kept apart because that file must stay free of
 * Node imports for the browser.
 */
export function isLoopbackSocketAddress(address: string | undefined): boolean {
    if (!address) {
        return false;
    }
    const normalized = address.toLowerCase();
    const family = isIP(normalized);
    if (family === 4) {
        return isIpv4Loopback(normalized);
    }
    if (family !== 6) {
        return false;
    }
    if (normalized === '::1') {
        return true;
    }
    if (normalized.startsWith(IPV4_MAPPED_PREFIX)) {
        const mapped = normalized.slice(IPV4_MAPPED_PREFIX.length);
        return isIP(mapped) === 4 && isIpv4Loopback(mapped);
    }
    return false;
}

function isIpv4Loopback(address: string): boolean {
    return address.split('.')[0] === '127';
}
