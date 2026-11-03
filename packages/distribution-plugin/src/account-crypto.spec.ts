import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';

// 模块在 import 时读取环境变量，必须先注入（禁止使用内置默认密钥的路径）
vi.hoisted(() => {
    process.env.DISTRIBUTION_ACCOUNT_SECRET = 'unit-test-secret-0123456789abcdef';
    process.env.DISTRIBUTION_ACCOUNT_SECRET_LEGACY = 'distribution-account-secret-dev';
});

import { decryptAccount, encryptAccount } from './account-crypto';

function legacyEncrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        crypto.scryptSync('distribution-account-secret-dev', 'salt', 32),
        iv,
    );
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

describe('distribution account-crypto', () => {
    it('新格式：加密/解密可往返，且带 v2 前缀', () => {
        const encrypted = encryptAccount('6222020202020202');
        expect(encrypted.startsWith('enc:v2:')).toBe(true);
        expect(decryptAccount(encrypted)).toBe('6222020202020202');
    });

    it('每行随机盐：相同明文两次加密结果不同', () => {
        const a = encryptAccount('13800001111');
        const b = encryptAccount('13800001111');
        expect(a).not.toBe(b);
        expect(decryptAccount(a)).toBe('13800001111');
        expect(decryptAccount(b)).toBe('13800001111');
    });

    it('双读兼容：历史固定盐密文仍可用 LEGACY 密钥解密', () => {
        const legacy = legacyEncrypt('6222020202020203');
        expect(legacy.startsWith('enc:v2:')).toBe(false);
        expect(decryptAccount(legacy)).toBe('6222020202020203');
    });
});
