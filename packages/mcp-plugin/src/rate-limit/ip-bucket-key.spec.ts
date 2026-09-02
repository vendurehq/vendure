import { describe, expect, it } from 'vitest';

import { ipBucketKey } from './ip-bucket-key';

describe('ipBucketKey', () => {
    it('leaves a plain IPv4 address alone', () => {
        expect(ipBucketKey('1.2.3.4')).toBe('1.2.3.4');
    });

    it('reduces an IPv4-mapped IPv6 address to the IPv4 address it carries', () => {
        // A dual-stack client would otherwise get two separate allowances for the same machine.
        expect(ipBucketKey('::ffff:1.2.3.4')).toBe('1.2.3.4');
        expect(ipBucketKey('::FFFF:1.2.3.4')).toBe('1.2.3.4');
    });

    it('gives two addresses in the same IPv6 /64 the same key', () => {
        const first = ipBucketKey('2001:db8:1234:5678:1111:2222:3333:4444');
        const second = ipBucketKey('2001:db8:1234:5678:aaaa:bbbb:cccc:dddd');
        expect(first).toBe(second);
    });

    it('gives two addresses in different IPv6 /64s different keys', () => {
        const first = ipBucketKey('2001:db8:1234:5678::1');
        const second = ipBucketKey('2001:db8:1234:9999::1');
        expect(first).not.toBe(second);
    });

    it('treats a compressed and a fully written form of one address as the same /64', () => {
        expect(ipBucketKey('2001:db8::1')).toBe(ipBucketKey('2001:0db8:0000:0000:0000:0000:0000:0002'));
    });

    it('returns "unknown" when there is no address', () => {
        expect(ipBucketKey(undefined)).toBe('unknown');
    });

    it('returns a value that is not an address unchanged, so it still keys a bucket', () => {
        // getClientIp already rejects anything net.isIP does not recognise, so this only guards
        // against a future caller passing something else through.
        expect(ipBucketKey('not-an-ip')).toBe('not-an-ip');
    });
});
