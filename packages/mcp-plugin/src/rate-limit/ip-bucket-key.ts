import { isIP } from 'node:net';

const IPV4_MAPPED_PREFIX = /^::ffff:/i;

// An IPv6 address is keyed by its first 64 bits, since a single machine can pick a fresh address from its /64 for every request.
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

// Node has no built-in expander, and two written forms of the same address must produce the same key.
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
