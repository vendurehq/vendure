import { Logger } from '@vendure/core';
import * as crypto from 'crypto';

const IS_PROD = process.env.NODE_ENV === 'production' || process.env.IS_PROD === 'true';

/**
 * 账户信息加密密钥：
 * - 生产必须显式配置 DISTRIBUTION_ACCOUNT_SECRET，缺失直接拒绝启动（不再有内置默认密钥）。
 * - 开发环境缺失时使用进程级随机密钥（非固定常量），仅用于本地调试；重启后旧密文不可解。
 */
const ENV_SECRET = process.env.DISTRIBUTION_ACCOUNT_SECRET;
if (!ENV_SECRET && IS_PROD) {
    throw new Error(
        'DISTRIBUTION_ACCOUNT_SECRET 未配置，拒绝启动：分销提现账户信息必须使用显式密钥加密',
    );
}
if (ENV_SECRET && IS_PROD && ENV_SECRET.length < 16) {
    throw new Error('DISTRIBUTION_ACCOUNT_SECRET 长度不足 16 字符，拒绝启动');
}

const SECRET = ENV_SECRET || crypto.randomBytes(32).toString('hex');
if (!ENV_SECRET) {
    Logger.warn(
        'DISTRIBUTION_ACCOUNT_SECRET 未配置，已使用进程级随机密钥（仅限开发；重启后旧密文不可读）',
        'distribution-plugin',
    );
}

/**
 * 历史密文使用固定盐 + 旧密钥加密。轮换期间通过 LEGACY 密钥双读，避免存量数据不可用。
 * 生产部署需同时配置 DISTRIBUTION_ACCOUNT_SECRET_LEGACY=旧密钥 才能解密存量记录。
 */
const LEGACY_SECRET =
    process.env.DISTRIBUTION_ACCOUNT_SECRET_LEGACY ||
    (IS_PROD ? undefined : 'distribution-account-secret-dev');

const V2_PREFIX = 'enc:v2:';
const V1_PREFIX = 'enc:';

function deriveKey(secret: string, salt: string | Buffer): Buffer {
    return crypto.scryptSync(secret, salt, 32);
}

export function encryptAccount(plaintext: string): string {
    if (!plaintext) return '';
    // 每条记录独立随机盐，避免固定盐 + 相同明文产生相同密文
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(SECRET, salt), iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${V2_PREFIX}${salt.toString('hex')}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptAccount(ciphertext: string): string {
    if (!ciphertext || !ciphertext.startsWith(V1_PREFIX)) return ciphertext;

    // v2：随机盐（每条记录自带 salt）
    if (ciphertext.startsWith(V2_PREFIX)) {
        const [saltHex, ivHex, tagHex, dataHex] = ciphertext.slice(V2_PREFIX.length).split(':');
        const decipher = crypto.createDecipheriv(
            'aes-256-gcm',
            deriveKey(SECRET, Buffer.from(saltHex, 'hex')),
            Buffer.from(ivHex, 'hex'),
        );
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
        return dec.toString('utf8');
    }

    // v1（历史格式）：固定盐 'salt' + 旧密钥，双读兼容存量密文
    const [, ivHex, tagHex, dataHex] = ciphertext.split(':');
    if (!LEGACY_SECRET) {
        throw new Error(
            '检测到历史格式密文，但未配置 DISTRIBUTION_ACCOUNT_SECRET_LEGACY，无法解密；请补齐旧密钥后再启动',
        );
    }
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        deriveKey(LEGACY_SECRET, 'salt'),
        Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
}
