"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantApiTokenService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const crypto = __importStar(require("crypto"));
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
let MerchantApiTokenService = class MerchantApiTokenService {
    constructor() {
        const envSecret = process.env.MARKETPLACE_MERCHANT_API_SECRET;
        if (!envSecret) {
            if (IS_PROD) {
                throw new Error('MARKETPLACE_MERCHANT_API_SECRET 未配置，拒绝启动：merchant-api 必须使用服务端签发令牌');
            }
            this.secret = crypto.randomBytes(32).toString('hex');
            core_1.Logger.warn('MARKETPLACE_MERCHANT_API_SECRET 未配置，已使用进程级随机密钥（仅限开发；重启后已签发令牌失效）', 'marketplace-plugin');
        }
        else {
            this.secret = envSecret;
        }
    }
    /** 签发令牌（默认 24h） */
    issue(channelId, ttlSeconds = 24 * 60 * 60) {
        const expiresAt = Date.now() + ttlSeconds * 1000;
        const payload = `${channelId}.${expiresAt}`;
        const signature = this.sign(payload);
        return `mkat.${payload}.${signature}`;
    }
    /** 校验令牌；返回绑定的 channelId，非法/过期返回 undefined */
    verify(token) {
        const parts = token.split('.');
        if (parts.length !== 4 || parts[0] !== 'mkat') {
            return undefined;
        }
        const [, channelId, expiresAtStr, signature] = parts;
        const payload = `${channelId}.${expiresAtStr}`;
        const expected = this.sign(payload);
        // 常量时间比较，避免签名被逐字节探测
        if (signature.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            return undefined;
        }
        const expiresAt = Number(expiresAtStr);
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
            return undefined;
        }
        return { channelId };
    }
    sign(payload) {
        return crypto.createHmac('sha256', this.secret).update(payload).digest('base64url');
    }
};
exports.MerchantApiTokenService = MerchantApiTokenService;
exports.MerchantApiTokenService = MerchantApiTokenService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], MerchantApiTokenService);
