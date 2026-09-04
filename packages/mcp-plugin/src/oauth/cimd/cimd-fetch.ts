import { BadRequestException } from '@nestjs/common';
import { Logger } from '@vendure/core';
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { BlockList } from 'node:net';

import { loggerCtx, MAX_CONCURRENT_CIMD_FETCHES } from '../../constants';

// Validates DNS at connect time and limits response size, since client_id URLs are
// attacker-controlled and could otherwise be used to probe internal services.

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
// Blocks every IANA-reserved, non-public address range so a client_id URL can't be used
// to probe this server's own network.
// https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry.xhtml
// https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml
const blockedRanges = new BlockList();
blockedRanges.addSubnet('0.0.0.0', 8, 'ipv4');
blockedRanges.addSubnet('10.0.0.0', 8, 'ipv4');
blockedRanges.addSubnet('100.64.0.0', 10, 'ipv4');
blockedRanges.addSubnet('127.0.0.0', 8, 'ipv4');
blockedRanges.addSubnet('169.254.0.0', 16, 'ipv4');
blockedRanges.addSubnet('172.16.0.0', 12, 'ipv4');
blockedRanges.addSubnet('192.0.0.0', 24, 'ipv4');
blockedRanges.addSubnet('192.0.2.0', 24, 'ipv4');
blockedRanges.addSubnet('192.88.99.0', 24, 'ipv4');
blockedRanges.addSubnet('192.168.0.0', 16, 'ipv4');
blockedRanges.addSubnet('198.18.0.0', 15, 'ipv4');
blockedRanges.addSubnet('198.51.100.0', 24, 'ipv4');
blockedRanges.addSubnet('203.0.113.0', 24, 'ipv4');
blockedRanges.addSubnet('224.0.0.0', 4, 'ipv4');
blockedRanges.addSubnet('240.0.0.0', 4, 'ipv4');
blockedRanges.addSubnet('::', 128, 'ipv6');
blockedRanges.addSubnet('::1', 128, 'ipv6');
blockedRanges.addSubnet('64:ff9b::', 96, 'ipv6');
blockedRanges.addSubnet('64:ff9b:1::', 48, 'ipv6');
blockedRanges.addSubnet('100::', 64, 'ipv6');
blockedRanges.addSubnet('100:0:0:1::', 64, 'ipv6');
blockedRanges.addSubnet('2001::', 23, 'ipv6');
blockedRanges.addSubnet('2001:db8::', 32, 'ipv6');
blockedRanges.addSubnet('2002::', 16, 'ipv6');
blockedRanges.addSubnet('3fff::', 20, 'ipv6');
blockedRanges.addSubnet('5f00::', 16, 'ipv6');
blockedRanges.addSubnet('fc00::', 7, 'ipv6');
blockedRanges.addSubnet('fe80::', 10, 'ipv6');
blockedRanges.addSubnet('ff00::', 8, 'ipv6');

const loopbackRanges = new BlockList();
loopbackRanges.addSubnet('127.0.0.0', 8, 'ipv4');
loopbackRanges.addAddress('::1', 'ipv6');

/** True when a resolved address may be dialed. Loopback is only allowed in development. */
export function isAllowedCimdAddress(address: string, family: number, allowLoopback: boolean): boolean {
    const familyName = family === 6 ? 'ipv6' : 'ipv4';
    try {
        if (allowLoopback && loopbackRanges.check(address, familyName)) {
            return true;
        }
        return !blockedRanges.check(address, familyName);
    } catch {
        return false;
    }
}

/** Checks every address a hostname resolves to, since a hostname could mix a public and a private record to slip past a single check. */
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

/** Caps outbound fetches process-wide so many concurrent client_id URLs can't fan this server out into a flood of connections. */
let activeFetchCount = 0;

export async function fetchCimdDocument(url: URL, options: CimdFetchOptions): Promise<string> {
    if (activeFetchCount >= MAX_CONCURRENT_CIMD_FETCHES) {
        throw new BadRequestException('client_id metadata document could not be fetched');
    }
    activeFetchCount++;
    try {
        return await runFetch(url, options);
    } finally {
        activeFetchCount--;
    }
}

function runFetch(url: URL, options: CimdFetchOptions): Promise<string> {
    const transport = url.protocol === 'https:' ? https : http;
    const deadline = AbortSignal.timeout(options.timeoutMs);
    const timedOut = () => new BadRequestException('client_id metadata document request timed out');
    return new Promise<string>((resolve, reject) => {
        const fail = (error: Error) => {
            request.destroy();
            reject(error);
        };
        const request = transport.request(
            url,
            {
                method: 'GET',
                headers: { accept: 'application/json' },
                lookup: createGuardedLookup(options.allowLoopback, options.lookup ?? dns.lookup),
                // Disables connection reuse: a pooled socket would skip the lookup above, which is
                // where the address check happens.
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
                    resolve(Buffer.concat(chunks).toString('utf8'));
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
            Logger.warn(
                `Failed to fetch the client_id metadata document at ${url.hostname}: ${error.message}`,
                loggerCtx,
            );
            fail(new BadRequestException('client_id metadata document could not be fetched'));
        });
        request.end();
    });
}
