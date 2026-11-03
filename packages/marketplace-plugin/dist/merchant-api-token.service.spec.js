"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const merchant_api_token_service_1 = require("./merchant-api-token.service");
(0, vitest_1.describe)('MerchantApiTokenService', () => {
    const service = new merchant_api_token_service_1.MerchantApiTokenService();
    (0, vitest_1.it)('签发的令牌可校验，并绑定 channelId', () => {
        const token = service.issue('42', 60);
        (0, vitest_1.expect)(token.startsWith('mkat.')).toBe(true);
        (0, vitest_1.expect)(service.verify(token)).toEqual({ channelId: '42' });
    });
    (0, vitest_1.it)('签名被篡改时校验失败', () => {
        const token = service.issue('42', 60);
        const parts = token.split('.');
        parts[3] = parts[3].slice(0, -1) + (parts[3].endsWith('A') ? 'B' : 'A');
        (0, vitest_1.expect)(service.verify(parts.join('.'))).toBeUndefined();
    });
    (0, vitest_1.it)('channelId 被篡改时校验失败（无需重算签名也无法越权）', () => {
        const token = service.issue('42', 60);
        const parts = token.split('.');
        parts[1] = '99';
        (0, vitest_1.expect)(service.verify(parts.join('.'))).toBeUndefined();
    });
    (0, vitest_1.it)('过期令牌校验失败', () => {
        const token = service.issue('42', -1);
        (0, vitest_1.expect)(service.verify(token)).toBeUndefined();
    });
    (0, vitest_1.it)('非 mkat 前缀（如 Channel token）校验失败', () => {
        (0, vitest_1.expect)(service.verify('default-token')).toBeUndefined();
    });
});
