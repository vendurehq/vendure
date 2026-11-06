/**
 * 飞书事件订阅加密解密：AES-256-CBC。
 * key = sha256(encryptKey)，iv = 密文前 16 字节；明文为 UTF-8 JSON 字符串。
 * 解密失败返回 null（调用方按无效请求处理），不抛错。
 */
export declare function decryptFeishuPayload(encrypt: string, encryptKey: string): any | null;
/** 飞书回调签名：sha256(timestamp + nonce + encryptKey + rawBody)，rawBody 拿不到时用 JSON.stringify(body) */
export declare function feishuSignature(timestamp: string, nonce: string, encryptKey: string, rawBody: string): string;
/** 定时安全比较两个 hex 签名：长度不等直接 false，避免 timingSafeEqual 抛错 */
export declare function signatureEquals(expected: string, given: string): boolean;
