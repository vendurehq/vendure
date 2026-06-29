import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InternalServerError } from '../../common/error/errors';
import { Logger } from '../logger/vendure-logger';

import { assertPublicUrl, DnsResolverFn } from './assert-public-url';

const makeResolver = (records: Array<{ address: string; family: number }>): DnsResolverFn =>
    vi.fn().mockResolvedValue(records);

describe('assertPublicUrl', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    describe('accepts', () => {
        it('a public IPv4 literal and returns the pinned address', async () => {
            const result = await assertPublicUrl('https://1.1.1.1/img.jpg');
            expect(result.url.host).toBe('1.1.1.1');
            expect(result.pinned).toEqual({ address: '1.1.1.1', family: 4 });
            expect(warnSpy).not.toHaveBeenCalled();
        });

        it('a hostname that resolves to a public IPv4 and pins to the resolved IP', async () => {
            const result = await assertPublicUrl('https://cdn.example.com/img.jpg', {
                resolver: makeResolver([{ address: '93.184.216.34', family: 4 }]),
            });
            expect(result.pinned).toEqual({ address: '93.184.216.34', family: 4 });
        });

        it('a public IPv6 literal', async () => {
            const result = await assertPublicUrl('https://[2606:4700::1111]/x');
            expect(result.pinned).toEqual({ address: '2606:4700::1111', family: 6 });
        });

        it('does not call DNS for IP literals', async () => {
            const resolver = vi.fn();
            await assertPublicUrl('https://1.1.1.1/x', { resolver });
            expect(resolver).not.toHaveBeenCalled();
        });
    });

    describe('rejects private / loopback / link-local IPv4', () => {
        it('loopback', async () => {
            await expect(assertPublicUrl('http://127.0.0.1/x')).rejects.toBeInstanceOf(InternalServerError);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('127.0.0.1'),
                'DefaultAssetImportStrategy',
            );
        });

        it('cloud metadata IP (169.254.169.254)', async () => {
            await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data/')).rejects.toBeInstanceOf(
                InternalServerError,
            );
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('169.254.169.254'),
                'DefaultAssetImportStrategy',
            );
        });

        it('RFC 1918 ranges', async () => {
            await expect(assertPublicUrl('http://10.0.0.5/x')).rejects.toBeInstanceOf(InternalServerError);
            await expect(assertPublicUrl('http://172.16.1.1/x')).rejects.toBeInstanceOf(InternalServerError);
            await expect(assertPublicUrl('http://192.168.1.1/x')).rejects.toBeInstanceOf(InternalServerError);
        });

        it('CGNAT (100.64.0.0/10)', async () => {
            await expect(assertPublicUrl('http://100.64.0.1/x')).rejects.toBeInstanceOf(InternalServerError);
        });

        it('current-network (0.0.0.0/8)', async () => {
            await expect(assertPublicUrl('http://0.0.0.0/x')).rejects.toBeInstanceOf(InternalServerError);
        });
    });

    describe('rejects non-public IPv6', () => {
        it('IPv6 loopback ::1', async () => {
            await expect(assertPublicUrl('http://[::1]/x')).rejects.toBeInstanceOf(InternalServerError);
        });

        it('IPv6 link-local fe80::', async () => {
            await expect(assertPublicUrl('http://[fe80::1]/x')).rejects.toBeInstanceOf(InternalServerError);
        });

        it('IPv4-mapped IPv6 loopback [::ffff:127.0.0.1]', async () => {
            await expect(assertPublicUrl('http://[::ffff:127.0.0.1]/x')).rejects.toBeInstanceOf(
                InternalServerError,
            );
        });

        it('IPv4-mapped IPv6 metadata IP [::ffff:169.254.169.254]', async () => {
            await expect(assertPublicUrl('http://[::ffff:169.254.169.254]/x')).rejects.toBeInstanceOf(
                InternalServerError,
            );
        });

        it('IPv4-mapped IPv6 RFC 1918 [::ffff:10.0.0.1]', async () => {
            await expect(assertPublicUrl('http://[::ffff:10.0.0.1]/x')).rejects.toBeInstanceOf(
                InternalServerError,
            );
        });

        it('6to4 [2002::/16]', async () => {
            await expect(assertPublicUrl('http://[2002:c0a8:0101::1]/x')).rejects.toBeInstanceOf(
                InternalServerError,
            );
        });

        it('Teredo [2001::/32]', async () => {
            await expect(assertPublicUrl('http://[2001:0:1::1]/x')).rejects.toBeInstanceOf(
                InternalServerError,
            );
        });

        it('NAT64 [64:ff9b::/96]', async () => {
            await expect(assertPublicUrl('http://[64:ff9b::1]/x')).rejects.toBeInstanceOf(
                InternalServerError,
            );
        });

        it('discard prefix [100::/64]', async () => {
            await expect(assertPublicUrl('http://[100::1]/x')).rejects.toBeInstanceOf(InternalServerError);
        });

        it('IPv6 unique-local fc00::/7', async () => {
            await expect(assertPublicUrl('http://[fc00::1]/x')).rejects.toBeInstanceOf(InternalServerError);
            await expect(assertPublicUrl('http://[fd00::1]/x')).rejects.toBeInstanceOf(InternalServerError);
        });

        it('IPv6 link-local with zone-id is stripped and still blocked', async () => {
            await expect(assertPublicUrl('http://[fe80::1%25eth0]/x')).rejects.toBeInstanceOf(
                InternalServerError,
            );
        });

        it('handles uppercase IPv6 hex literals', async () => {
            await expect(assertPublicUrl('http://[FE80::1]/x')).rejects.toBeInstanceOf(InternalServerError);
        });
    });

    describe('DNS-aware', () => {
        it('rejects a hostname that resolves to a private IPv4', async () => {
            await expect(
                assertPublicUrl('http://internal.example.com/x', {
                    resolver: makeResolver([{ address: '10.0.0.5', family: 4 }]),
                }),
            ).rejects.toBeInstanceOf(InternalServerError);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('10.0.0.5'),
                'DefaultAssetImportStrategy',
            );
        });

        it('rejects if ANY of multiple resolved addresses is private', async () => {
            await expect(
                assertPublicUrl('http://mixed.example.com/x', {
                    resolver: makeResolver([
                        { address: '1.1.1.1', family: 4 },
                        { address: '127.0.0.1', family: 4 },
                    ]),
                }),
            ).rejects.toBeInstanceOf(InternalServerError);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('127.0.0.1'),
                'DefaultAssetImportStrategy',
            );
        });

        it('rejects a hostname that resolves to an IPv4-mapped IPv6 private address', async () => {
            await expect(
                assertPublicUrl('http://internal.example.com/x', {
                    resolver: makeResolver([{ address: '::ffff:127.0.0.1', family: 6 }]),
                }),
            ).rejects.toBeInstanceOf(InternalServerError);
        });

        it('rejects when DNS lookup itself fails', async () => {
            const resolver: DnsResolverFn = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
            await expect(
                assertPublicUrl('http://nonexistent.example.com/x', { resolver }),
            ).rejects.toBeInstanceOf(InternalServerError);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('DNS lookup failed'),
                'DefaultAssetImportStrategy',
            );
        });
    });

    describe('protocol & malformed URLs', () => {
        it('rejects non-http(s) protocols', async () => {
            await expect(assertPublicUrl('file:///etc/passwd')).rejects.toBeInstanceOf(InternalServerError);
            await expect(assertPublicUrl('ftp://example.com/x')).rejects.toBeInstanceOf(InternalServerError);
            await expect(assertPublicUrl('gopher://1.1.1.1/x')).rejects.toBeInstanceOf(InternalServerError);
        });

        it('rejects malformed URLs', async () => {
            await expect(assertPublicUrl('not a url')).rejects.toBeInstanceOf(InternalServerError);
        });
    });

    describe('error-message hardening', () => {
        it('throws a generic message that does not leak the URL or remediation hint', async () => {
            await expect(assertPublicUrl('http://127.0.0.1/secret-path')).rejects.toMatchObject({
                message: expect.not.stringContaining('127.0.0.1'),
            });
            await expect(assertPublicUrl('http://127.0.0.1/secret-path')).rejects.toMatchObject({
                message: expect.not.stringContaining('allowPrivateNetworks'),
            });
        });

        it('routes the remediation hint to Logger.warn instead of the thrown error', async () => {
            await expect(assertPublicUrl('http://127.0.0.1/x')).rejects.toBeInstanceOf(InternalServerError);
            expect(warnSpy).toHaveBeenCalledWith(
                expect.stringContaining('allowPrivateNetworks'),
                'DefaultAssetImportStrategy',
            );
        });

        it('strips control characters from URLs in log messages (log-forgery defence)', async () => {
            await expect(assertPublicUrl('not\r\nfake-log-line a url')).rejects.toBeInstanceOf(
                InternalServerError,
            );
            const [logged] = warnSpy.mock.calls[0] ?? [];
            expect(logged).toBeDefined();
            expect(logged).not.toMatch(/[\r\n]/);
        });

        it('truncates very long URLs in log messages', async () => {
            const longUrl = 'http://127.0.0.1/' + 'a'.repeat(5000);
            await expect(assertPublicUrl(longUrl)).rejects.toBeInstanceOf(InternalServerError);
            const [logged] = warnSpy.mock.calls.find(call => String(call[0]).includes('127.0.0.1')) ?? [''];
            expect(String(logged).length).toBeLessThan(longUrl.length);
        });
    });

    describe('allowPrivateNetworks bypass', () => {
        it('bypasses all private-network checks but returns no pinned IP', async () => {
            const result = await assertPublicUrl('http://127.0.0.1/x', {
                allowPrivateNetworks: true,
            });
            expect(result.pinned).toBeNull();
            expect(result.url.host).toBe('127.0.0.1');
        });

        it('bypasses DNS resolution entirely (no resolver call)', async () => {
            const resolver = vi.fn();
            await assertPublicUrl('http://internal.example.com/x', {
                allowPrivateNetworks: true,
                resolver,
            });
            expect(resolver).not.toHaveBeenCalled();
        });

        it('still rejects unsupported protocols even with allowPrivateNetworks=true', async () => {
            await expect(
                assertPublicUrl('file:///etc/passwd', { allowPrivateNetworks: true }),
            ).rejects.toBeInstanceOf(InternalServerError);
        });
    });
});
