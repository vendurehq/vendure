import { createDecipheriv, createHash, timingSafeEqual } from 'crypto';

/**
 * 飞书事件订阅加密解密：AES-256-CBC。
 * key = sha256(encryptKey)，iv = 密文前 16 字节；明文为 UTF-8 JSON 字符串。
 * 解密失败返回 null（调用方按无效请求处理），不抛错。
 */
export function decryptFeishuPayload(encrypt: string, encryptKey: string): any | null {
    if (!encrypt || !encryptKey) return null;
    try {
        const key = createHash('sha256').update(encryptKey).digest();
        const data = Buffer.from(encrypt, 'base64');
        if (data.length <= 16) return null;
        const iv = data.subarray(0, 16);
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        const plain = Buffer.concat([decipher.update(data.subarray(16)), decipher.final()]).toString('utf8');
        return JSON.parse(plain);
    } catch {
        return null;
    }
}

/** 飞书回调签名：sha256(timestamp + nonce + encryptKey + rawBody)，rawBody 拿不到时用 JSON.stringify(body) */
export function feishuSignature(timestamp: string, nonce: string, encryptKey: string, rawBody: string): string {
    return createHash('sha256').update(`${timestamp}${nonce}${encryptKey}${rawBody}`).digest('hex');
}

/** 定时安全比较两个 hex 签名：长度不等直接 false，避免 timingSafeEqual 抛错 */
export function signatureEquals(expected: string, given: string): boolean {
    if (!expected || !given) return false;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(given, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
}
