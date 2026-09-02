import { isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = /^::ffff:/i;

/**
 * The rate-limit bucket key for a client address.
 *
 * An IPv6 address is keyed by its first 64 bits, because a single machine is routinely handed a
 * whole /64 and can pick a fresh address from it for every request. Without this, every one of
 * those addresses would get its own allowance. An IPv4 address written in IPv6 form
 * (`::ffff:1.2.3.4`) is reduced to the plain IPv4 address, so a dual-stack client gets one
 * allowance rather than two.
 */
export function ipBucketKey(clientIp?: string): string {
    if (clientIp == null) {
        return 'unknown';
    }
    const mappedIpv4 = clientIp.replace(IPV4_MAPPED_PREFIX, '');
    if (mappedIpv4 !== clientIp && isIP(mappedIpv4) === 4) {
        return mappedIpv4;
    }
    if (isIP(clientIp) !== 6) {
        // IPv4 is keyed as it stands. getClientIp() has already dropped anything that is not an address.
        return clientIp;
    }
    return `${expandIpv6(clientIp).slice(0, 4).join(':')}::/64`;
}

/**
 * Writes an IPv6 address out as its eight groups, filling in the run of zero groups that `::`
 * stands for. Node has no built-in expander, and two forms of the same address must produce the
 * same key.
 */
function expandIpv6(address: string): string[] {
    const [head, tail] = address.split('::');
    const headGroups = head === '' ? [] : head.split(':');
    if (tail === undefined) {
        return headGroups.map(normalizeGroup);
    }
    const tailGroups = tail === '' ? [] : tail.split(':');
    const zeroGroups = new Array(8 - headGroups.length - tailGroups.length).fill('0000');
    return [...headGroups.map(normalizeGroup), ...zeroGroups, ...tailGroups.map(normalizeGroup)];
}

function normalizeGroup(group: string): string {
    return group.toLowerCase().padStart(4, '0');
}
