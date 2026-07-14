import { lookup } from 'dns/promises';
import { BlockList, isIP } from 'net';

import { InternalServerError } from '../../common/error/errors';
import { Logger } from '../logger/vendure-logger';

const loggerCtx = 'DefaultAssetImportStrategy';

/**
 * BlockList covering private, loopback, link-local, IPv4-mapped IPv6, 6to4,
 * Teredo, NAT64, discard and unspecified ranges. Used by {@link assertPublicUrl}
 * to prevent the `DefaultAssetImportStrategy` from issuing requests that could
 * be abused for server-side request forgery against the host's internal network
 * or cloud metadata services (e.g. `169.254.169.254`).
 */
const privateBlockList = (() => {
    const bl = new BlockList();
    // IPv4
    bl.addSubnet('0.0.0.0', 8); // current network
    bl.addSubnet('10.0.0.0', 8); // RFC 1918
    bl.addSubnet('100.64.0.0', 10); // CGNAT (RFC 6598)
    bl.addSubnet('127.0.0.0', 8); // loopback
    bl.addSubnet('169.254.0.0', 16); // link-local + cloud metadata
    bl.addSubnet('172.16.0.0', 12); // RFC 1918
    bl.addSubnet('192.0.0.0', 24); // IETF protocol assignments
    bl.addSubnet('192.168.0.0', 16); // RFC 1918
    bl.addSubnet('198.18.0.0', 15); // network benchmarking
    // IPv6
    bl.addAddress('::', 'ipv6'); // unspecified
    bl.addAddress('::1', 'ipv6'); // loopback
    bl.addSubnet('64:ff9b::', 96, 'ipv6'); // NAT64 (could tunnel to private v4)
    bl.addSubnet('100::', 64, 'ipv6'); // discard prefix
    bl.addSubnet('2001::', 32, 'ipv6'); // Teredo
    bl.addSubnet('2002::', 16, 'ipv6'); // 6to4
    bl.addSubnet('fc00::', 7, 'ipv6'); // unique local
    bl.addSubnet('fe80::', 10, 'ipv6'); // link-local
    // IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is handled separately in
    // `isBlocked()` below — adding it as a BlockList subnet would create false
    // positives for plain IPv4 lookups due to a Node-internal v6→v4 projection.
    return bl;
})();

/**
 * Matches `::ffff:` prefix in any casing. The trailing segment is checked with
 * `isIP` rather than parsed by us, so this regex only gates the lookup.
 */
const IPV4_MAPPED_IPV6_PREFIX = /^::ffff:/i;

/**
 * Checks an address against the private BlockList. Handles IPv4-mapped IPv6
 * addresses (`::ffff:a.b.c.d`) by extracting the embedded IPv4 and re-checking
 * against the IPv4 ranges — Node's BlockList does not project v6 → v4
 * automatically, and adding the `::ffff:0:0/96` subnet to the BlockList causes
 * plain IPv4 lookups to false-positive due to an internal mapping quirk.
 */
function isBlocked(address: string, family: 4 | 6): boolean {
    if (family === 6 && IPV4_MAPPED_IPV6_PREFIX.test(address)) {
        const embedded = address.slice('::ffff:'.length);
        if (isIP(embedded) === 4) {
            return privateBlockList.check(embedded, 'ipv4');
        }
        // Hex-form IPv4-mapped (e.g. `::ffff:7f00:1`). Convert the trailing two
        // 16-bit groups to dotted-quad and re-check.
        const hexMatch = embedded.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
        if (hexMatch) {
            const high = parseInt(hexMatch[1], 16);
            const low = parseInt(hexMatch[2], 16);
            if (Number.isFinite(high) && Number.isFinite(low) && high <= 0xffff && low <= 0xffff) {
                /* eslint-disable no-bitwise */
                const dotted = [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join('.');
                /* eslint-enable no-bitwise */
                return privateBlockList.check(dotted, 'ipv4');
            }
        }
        // Fall through: an unparseable `::ffff:` form is itself suspicious. Block.
        return true;
    }
    return privateBlockList.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

const MAX_LOGGED_URL_LENGTH = 200;
const GENERIC_REJECTION_MESSAGE = 'Refusing to fetch asset URL: target is not a public network address';
const GENERIC_INVALID_URL_MESSAGE = 'Refusing to fetch asset URL: invalid or unsupported URL';

/**
 * Truncates and strips control characters from a URL before it is embedded in
 * log messages. Prevents log forgery via CRLF injection in attacker-controlled
 * URLs.
 */
function safeForLog(value: string): string {
    return value.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, MAX_LOGGED_URL_LENGTH);
}

export interface PinnedAddress {
    address: string;
    family: 4 | 6;
}

export type DnsResolverFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultResolver: DnsResolverFn = hostname => lookup(hostname, { all: true, verbatim: true });

/**
 * @description
 * Validates a URL before allowing the asset importer to fetch it. Rejects:
 * - non-http(s) schemes
 * - hostnames that resolve to private, loopback, link-local, IPv4-mapped IPv6
 *   or other non-public address ranges (covers SSRF against cloud metadata and
 *   internal services)
 *
 * On success, returns the parsed URL plus the address that was validated so the
 * caller can connect directly to that IP. Pinning the validated IP for the
 * subsequent fetch closes the DNS-rebinding TOCTOU window — without it,
 * `http.get` would perform a second, independent DNS lookup and could resolve
 * the same hostname to a private IP this time around.
 *
 * On failure, the thrown {@link InternalServerError} carries a generic message;
 * the specific reason (URL, resolved IP, remediation hint) is emitted via
 * `Logger.warn` so operators can see it without the client learning about the
 * `allowPrivateNetworks` bypass.
 *
 * Exported for unit testing; production callers should not pass a resolver
 * override.
 */
export async function assertPublicUrl(
    urlString: string,
    options: { allowPrivateNetworks?: boolean; resolver?: DnsResolverFn } = {},
): Promise<{ url: URL; pinned: PinnedAddress | null }> {
    let url: URL;
    try {
        url = new URL(urlString);
    } catch (_) {
        Logger.warn(`Refusing to fetch invalid URL: ${safeForLog(urlString)}`, loggerCtx);
        throw new InternalServerError(GENERIC_INVALID_URL_MESSAGE);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        Logger.warn(
            `Refusing to fetch URL with unsupported protocol "${url.protocol}": ${safeForLog(urlString)}`,
            loggerCtx,
        );
        throw new InternalServerError(GENERIC_INVALID_URL_MESSAGE);
    }

    if (options.allowPrivateNetworks) {
        return { url, pinned: null };
    }

    // WHATWG URL keeps the brackets around IPv6 literals in `hostname`; strip
    // them so `isIP` and the BlockList can parse the address. Also drop any
    // zone-id suffix (e.g. `fe80::1%eth0`) since BlockList does not accept
    // zone-tagged addresses.
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    const resolve = options.resolver ?? defaultResolver;

    let addresses: Array<{ address: string; family: number }>;
    const literalFamily = isIP(hostname);
    if (literalFamily === 4 || literalFamily === 6) {
        addresses = [{ address: hostname, family: literalFamily }];
    } else if (literalFamily === 0 && hostname.length > 0) {
        try {
            addresses = await resolve(hostname);
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            Logger.warn(
                `Refusing to fetch ${safeForLog(urlString)}: DNS lookup failed (${safeForLog(message)})`,
                loggerCtx,
            );
            throw new InternalServerError(GENERIC_REJECTION_MESSAGE);
        }
    } else {
        Logger.warn(`Refusing to fetch URL with empty hostname: ${safeForLog(urlString)}`, loggerCtx);
        throw new InternalServerError(GENERIC_INVALID_URL_MESSAGE);
    }

    for (const { address, family } of addresses) {
        const normalisedFamily: 4 | 6 = family === 6 ? 6 : 4;
        if (isBlocked(address, normalisedFamily)) {
            Logger.warn(
                `Refusing to fetch ${safeForLog(urlString)}: resolves to non-public address ${address}. ` +
                    'Set `assetImportStrategy: new DefaultAssetImportStrategy({ allowPrivateNetworks: true })` ' +
                    'in your VendureConfig if this is intentional (e.g. a trusted internal asset server).',
                loggerCtx,
            );
            throw new InternalServerError(GENERIC_REJECTION_MESSAGE);
        }
    }

    const first = addresses[0];
    const pinned: PinnedAddress = {
        address: first.address,
        family: first.family === 6 ? 6 : 4,
    };
    return { url, pinned };
}
