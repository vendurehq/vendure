import { Injectable } from '@nestjs/common';
import { Logger } from '@vendure/core';
import * as crypto from 'crypto';

const IS_PROD = process.env.NODE_ENV === 'production' || process.env.IS_PROD === 'true';

/**
 * merchant-api 的服务端签发令牌（HMAC 签名，绑定 channelId + 过期时间）。
 *
 * 背景：此前 merchant-api 直接用 Channel token（`${shopCode}-token`）作 Bearer，
 * 而 Channel token 在 storefront 请求头中公开可见，等同共享口令。
 *
 * 令牌格式：`mkat.<channelId>.<expiresAtMs>.<hmacSha256>`
 * - 只有服务端持有签名密钥，客户端无法伪造/枚举；
 * - channelId 与签名绑定，请求只能访问令牌所属渠道的数据。
 */
@Injectable()
export class MerchantApiTokenService {
    private readonly secret: string;

    constructor() {
        const envSecret = process.env.MARKETPLACE_MERCHANT_API_SECRET;
        if (!envSecret) {
            if (IS_PROD) {
                throw new Error(
                    'MARKETPLACE_MERCHANT_API_SECRET 未配置，拒绝启动：merchant-api 必须使用服务端签发令牌',
                );
            }
            this.secret = crypto.randomBytes(32).toString('hex');
            Logger.warn(
                'MARKETPLACE_MERCHANT_API_SECRET 未配置，已使用进程级随机密钥（仅限开发；重启后已签发令牌失效）',
                'marketplace-plugin',
            );
        } else {
            this.secret = envSecret;
        }
    }

    /** 签发令牌（默认 24h） */
    issue(channelId: string | number, ttlSeconds = 24 * 60 * 60): string {
        const expiresAt = Date.now() + ttlSeconds * 1000;
        const payload = `${channelId}.${expiresAt}`;
        const signature = this.sign(payload);
        return `mkat.${payload}.${signature}`;
    }

    /** 校验令牌；返回绑定的 channelId，非法/过期返回 undefined */
    verify(token: string): { channelId: string } | undefined {
        const parts = token.split('.');
        if (parts.length !== 4 || parts[0] !== 'mkat') {
            return undefined;
        }
        const [, channelId, expiresAtStr, signature] = parts;
        const payload = `${channelId}.${expiresAtStr}`;
        const expected = this.sign(payload);
        // 常量时间比较，避免签名被逐字节探测
        if (
            signature.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
        ) {
            return undefined;
        }
        const expiresAt = Number(expiresAtStr);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            return undefined;
        }
        return { channelId };
    }

    private sign(payload: string): string {
        return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
    }
}
