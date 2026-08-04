import { BadRequestException } from '@nestjs/common';
import { Logger } from '@vendure/core';
import * as dns from 'dns';
import * as http from 'http';
import * as https from 'https';
import { BlockList } from 'net';

import { loggerCtx } from '../../constants';

// SSRF-guarded fetch for CIMD client metadata documents.
//
// The address check runs inside the DNS lookup the socket actually uses, so the address
// that is checked is the address that is dialed — there is no window for a DNS-rebinding
// swap between a pre-check and the request. Redirects are never followed (node's http
// clients do not follow them, and any non-200 status is an error per draft §5), and the
// body is read through a byte counter with a hard cap (§8.7).

export interface CimdFetchOptions {
    /** Whole-request deadline — connection plus body — in milliseconds. */
    timeoutMs: number;
    /** Hard cap on the response body size, in bytes. */
    maxBytes: number;
    /** Permit loopback destinations. Development only (draft §8.6). */
    allowLoopback: boolean;
    /** DNS lookup used by the socket; injectable for tests. */
    lookup?: typeof dns.lookup;
}

export interface CimdFetchResult {
    /** The raw response body. */
    body: string;
}

// RFC 6890 special-use ranges (draft §8.6 forbids fetching anything that resolves here):
// "this host", private, CGNAT, loopback, link-local, protocol-assignment, documentation,
// benchmarking, multicast, reserved — and their IPv6 equivalents. IPv4-mapped IPv6
// addresses (::ffff:a.b.c.d, the classic bypass for v4-only blocklists) need no rule of
// their own: node's BlockList unwraps them and checks the IPv4 rules.
const blockedRanges = new BlockList();
blockedRanges.addSubnet('0.0.0.0', 8, 'ipv4');
blockedRanges.addSubnet('10.0.0.0', 8, 'ipv4');
blockedRanges.addSubnet('100.64.0.0', 10, 'ipv4');
blockedRanges.addSubnet('127.0.0.0', 8, 'ipv4');
blockedRanges.addSubnet('169.254.0.0', 16, 'ipv4');
blockedRanges.addSubnet('172.16.0.0', 12, 'ipv4');
blockedRanges.addSubnet('192.0.0.0', 24, 'ipv4');
blockedRanges.addSubnet('192.0.2.0', 24, 'ipv4');
blockedRanges.addSubnet('192.168.0.0', 16, 'ipv4');
blockedRanges.addSubnet('198.18.0.0', 15, 'ipv4');
blockedRanges.addSubnet('198.51.100.0', 24, 'ipv4');
blockedRanges.addSubnet('203.0.113.0', 24, 'ipv4');
blockedRanges.addSubnet('224.0.0.0', 4, 'ipv4');
blockedRanges.addSubnet('240.0.0.0', 4, 'ipv4');
blockedRanges.addSubnet('::', 128, 'ipv6');
blockedRanges.addSubnet('::1', 128, 'ipv6');
blockedRanges.addSubnet('64:ff9b::', 96, 'ipv6');
blockedRanges.addSubnet('100::', 64, 'ipv6');
blockedRanges.addSubnet('2001::', 32, 'ipv6');
blockedRanges.addSubnet('2001:db8::', 32, 'ipv6');
blockedRanges.addSubnet('2002::', 16, 'ipv6');
blockedRanges.addSubnet('fc00::', 7, 'ipv6');
blockedRanges.addSubnet('fe80::', 10, 'ipv6');
blockedRanges.addSubnet('ff00::', 8, 'ipv6');

const loopbackRanges = new BlockList();
loopbackRanges.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackRanges.addAddress('::1', 'ipv6');

/** True when a resolved address may be dialed. Loopback is only allowed in development. */
export function isAllowedCimdAddress(
    address: string,
    family: number | string,
    allowLoopback: boolean,
): boolean {
    const familyName = family === 6 || family === 'IPv6' || family === 'ipv6' ? 'ipv6' : 'ipv4';
    try {
        if (allowLoopback && loopbackRanges.check(address, familyName)) {
            return true;
        }
        return !blockedRanges.check(address, familyName);
    } catch {
        return false;
    }
}

/**
 * Wraps `dns.lookup` so that every address the hostname resolves to is checked against the
 * special-use blocklist before the socket may connect. All addresses must pass — a hostname
 * with one public and one private record is refused outright.
 */
function createGuardedLookup(allowLoopback: boolean, baseLookup: typeof dns.lookup): typeof dns.lookup {
    const guarded = (hostname: string, optionsOrCallback: any, maybeCallback?: any) => {
        const callerOptions = typeof optionsOrCallback === 'function' ? {} : (optionsOrCallback ?? {});
        const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback;
        baseLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error) {
                return callback(error);
            }
            const list = Array.isArray(addresses) ? addresses : [];
            const allAllowed =
                list.length > 0 &&
                list.every(entry => isAllowedCimdAddress(entry.address, entry.family, allowLoopback));
            if (!allAllowed) {
                return callback(new Error('client_id host does not resolve to a public address'));
            }
            // The socket may ask for one address or (with `all`, e.g. for happy-eyeballs
            // connection racing) the whole list — answer in the shape it asked for.
            if (callerOptions.all) {
                return callback(null, list);
            }
            callback(null, list[0].address, list[0].family);
        });
    };
    return guarded as typeof dns.lookup;
}

const jsonContentType = /^application\/(?:[^;+\s]+\+)?json\s*(?:;.*)?$/i;

/**
 * Fetches a client metadata document. Exactly one GET; a 200 JSON response within the
 * size and time budgets resolves, anything else rejects with a BadRequestException.
 */
export function fetchCimdDocument(url: URL, options: CimdFetchOptions): Promise<CimdFetchResult> {
    const transport = url.protocol === 'https:' ? https : http;
    const deadline = AbortSignal.timeout(options.timeoutMs);
    const timedOut = () => new BadRequestException('client_id metadata document request timed out');
    return new Promise<CimdFetchResult>((resolve, reject) => {
        let settled = false;
        const fail = (error: Error) => {
            if (!settled) {
                settled = true;
                request.destroy();
                reject(error);
            }
        };
        const succeed = (result: CimdFetchResult) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        const request = transport.request(
            url,
            {
                method: 'GET',
                headers: { accept: 'application/json' },
                lookup: createGuardedLookup(options.allowLoopback, options.lookup ?? dns.lookup),
                // A fresh connection per request. Node's default agent keeps sockets alive and
                // pools them by host and port only, so a socket another part of the server left
                // open could be handed to this request — and a reused socket never runs the
                // lookup above, which is where the address check lives.
                agent: false,
                signal: deadline,
            },
            response => {
                if (response.statusCode !== 200) {
                    return fail(
                        new BadRequestException(
                            `client_id metadata document request failed with HTTP ${String(response.statusCode)}`,
                        ),
                    );
                }
                const contentType = String(response.headers['content-type'] ?? '');
                if (!jsonContentType.test(contentType)) {
                    return fail(new BadRequestException('client_id metadata document must be JSON'));
                }
                const chunks: Buffer[] = [];
                let received = 0;
                response.on('data', (chunk: Buffer) => {
                    received += chunk.length;
                    if (received > options.maxBytes) {
                        return fail(new BadRequestException('client_id metadata document is too large'));
                    }
                    chunks.push(chunk);
                });
                response.on('end', () => {
                    succeed({ body: Buffer.concat(chunks).toString('utf8') });
                });
                // The deadline destroys the request mid-body, which surfaces here rather than on
                // the request itself, so it has to be reported as the timeout it is.
                response.on('error', () =>
                    fail(
                        deadline.aborted
                            ? timedOut()
                            : new BadRequestException('client_id metadata document could not be read'),
                    ),
                );
            },
        );
        request.on('error', error => {
            if (error instanceof BadRequestException) {
                return fail(error);
            }
            if (deadline.aborted) {
                return fail(timedOut());
            }
            // Connection-level detail (refused, reset, TLS failure, a blocked address) goes to
            // the server log only. It must not reach the caller: the authorize endpoint needs no
            // credentials, so an error body that distinguishes these outcomes would report to
            // anyone what is listening on each address the server can reach.
            Logger.warn(
                `Failed to fetch the client_id metadata document at ${url.hostname}: ${error.message}`,
                loggerCtx,
            );
            fail(new BadRequestException('client_id metadata document could not be fetched'));
        });
        request.end();
    });
}
