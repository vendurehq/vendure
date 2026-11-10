"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const vitest_1 = require("vitest");
// 模块在 import 时读取环境变量，必须先注入（禁止使用内置默认密钥的路径）
vitest_1.vi.hoisted(() => {
    process.env.DISTRIBUTION_ACCOUNT_SECRET = 'unit-test-secret-0123456789abcdef';
    process.env.DISTRIBUTION_ACCOUNT_SECRET_LEGACY = 'distribution-account-secret-dev';
});
const account_crypto_1 = require("./account-crypto");
function legacyEncrypt(plaintext) {
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv('aes-256-gcm', crypto_1.default.scryptSync('distribution-account-secret-dev', 'salt', 32), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `enc:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}
(0, vitest_1.describe)('distribution account-crypto', () => {
    (0, vitest_1.it)('新格式：加密/解密可往返，且带 v2 前缀', () => {
        const encrypted = (0, account_crypto_1.encryptAccount)('6222020202020202');
        (0, vitest_1.expect)(encrypted.startsWith('enc:v2:')).toBe(true);
        (0, vitest_1.expect)((0, account_crypto_1.decryptAccount)(encrypted)).toBe('6222020202020202');
    });
    (0, vitest_1.it)('每行随机盐：相同明文两次加密结果不同', () => {
        const a = (0, account_crypto_1.encryptAccount)('13800001111');
        const b = (0, account_crypto_1.encryptAccount)('13800001111');
        (0, vitest_1.expect)(a).not.toBe(b);
        (0, vitest_1.expect)((0, account_crypto_1.decryptAccount)(a)).toBe('13800001111');
        (0, vitest_1.expect)((0, account_crypto_1.decryptAccount)(b)).toBe('13800001111');
    });
    (0, vitest_1.it)('双读兼容：历史固定盐密文仍可用 LEGACY 密钥解密', () => {
        const legacy = legacyEncrypt('6222020202020203');
        (0, vitest_1.expect)(legacy.startsWith('enc:v2:')).toBe(false);
        (0, vitest_1.expect)((0, account_crypto_1.decryptAccount)(legacy)).toBe('6222020202020203');
    });
});
//# sourceMappingURL=account-crypto.spec.js.map