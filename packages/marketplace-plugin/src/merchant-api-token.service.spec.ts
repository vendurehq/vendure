import { describe, expect, it } from 'vitest';

import { MerchantApiTokenService } from './merchant-api-token.service';

describe('MerchantApiTokenService', () => {
    const service = new MerchantApiTokenService();

    it('签发的令牌可校验，并绑定 channelId', () => {
        const token = service.issue('42', 60);
        expect(token.startsWith('mkat.')).toBe(true);
        expect(service.verify(token)).toEqual({ channelId: '42' });
    });

    it('签名被篡改时校验失败', () => {
        const token = service.issue('42', 60);
        const parts = token.split('.');
        parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith('A') ? 'B' : 'A');
        expect(service.verify(parts.join('.'))).toBeUndefined();
    });

    it('channelId 被篡改时校验失败（无需重算签名也无法越权）', () => {
        const token = service.issue('42', 60);
        const parts = token.split('.');
        parts[1] = '99';
        expect(service.verify(parts.join('.'))).toBeUndefined();
    });

    it('过期令牌校验失败', () => {
        const token = service.issue('42', -1);
        expect(service.verify(token)).toBeUndefined();
    });

    it('非 mkat 前缀（如 Channel token）校验失败', () => {
        expect(service.verify('default-token')).toBeUndefined();
    });
});
