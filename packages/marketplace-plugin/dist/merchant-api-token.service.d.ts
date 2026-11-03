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
export declare class MerchantApiTokenService {
    private readonly secret;
    constructor();
    /** 签发令牌（默认 24h） */
    issue(channelId: string | number, ttlSeconds?: number): string;
    /** 校验令牌；返回绑定的 channelId，非法/过期返回 undefined */
    verify(token: string): {
        channelId: string;
    } | undefined;
    private sign;
}
