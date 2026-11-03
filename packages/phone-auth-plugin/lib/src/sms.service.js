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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsService = void 0;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const dysmsapi20170525_1 = __importStar(require("@alicloud/dysmsapi20170525"));
const openapi_client_1 = require("@alicloud/openapi-client");
const core_1 = require("@vendure/core");
const ioredis_1 = __importDefault(require("ioredis"));
const constants_1 = require("./constants");
const SEND_COOLDOWN_MS = 60000; // 同号发码冷却
const DAILY_SEND_LIMIT = 10; // 同号每日发码上限
/** 日志脱敏：手机号仅保留前 3 后 2 位 */
function maskPhone(phoneNumber) {
    if (!phoneNumber || phoneNumber.length <= 5) {
        return '****';
    }
    return `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-2)}`;
}
const MAX_VERIFY_FAILURES = 5; // 同一验证码连续失败 N 次后作废
class InMemoryStore {
    constructor() {
        this.codes = new Map();
        this.cooldowns = new Map();
        this.daily = new Map();
    }
    async getCode(phoneNumber) {
        return this.codes.get(phoneNumber);
    }
    async setCode(phoneNumber, rec) {
        this.codes.set(phoneNumber, rec);
    }
    async deleteCode(phoneNumber) {
        this.codes.delete(phoneNumber);
    }
    async isCoolingDown(phoneNumber) {
        const last = this.cooldowns.get(phoneNumber);
        return !!last && Date.now() - last < SEND_COOLDOWN_MS;
    }
    async markSent(phoneNumber) {
        this.cooldowns.set(phoneNumber, Date.now());
    }
    async incrDaily(phoneNumber, dayKey) {
        const key = `${phoneNumber}:${dayKey}`;
        const next = (this.daily.get(key) || 0) + 1;
        this.daily.set(key, next);
        return next;
    }
    /** 惰性清理：该号过期验证码 + 全局容量兜底（Redis 实现靠 TTL，无需此步） */
    sweep() {
        const now = Date.now();
        if (this.codes.size > 10000) {
            for (const [k, v] of this.codes) {
                if (now > v.expiresAt)
                    this.codes.delete(k);
            }
        }
        if (this.cooldowns.size > 10000) {
            for (const [k, t] of this.cooldowns) {
                if (now - t >= SEND_COOLDOWN_MS)
                    this.cooldowns.delete(k);
            }
        }
        if (this.daily.size > 50000) {
            const today = this.dayKey();
            for (const k of this.daily.keys()) {
                if (!k.endsWith(`:${today}`))
                    this.daily.delete(k);
            }
        }
    }
    dayKey() {
        const d = new Date();
        return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    }
}
const KEY_PREFIX = {
    code: 'phone-auth:code:',
    cooldown: 'phone-auth:cd:',
    daily: 'phone-auth:daily:',
};
/** INCR + 首次 EXPIRE 原子执行（Lua，Redis 2.6+ 兼容），避免两步之间崩溃导致当日 key 永不过期 */
const LUA_INCR_DAILY = `
local v = redis.call('INCR', KEYS[1])
if v == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return v
`;
class RedisStore {
    constructor(redis) {
        this.redis = redis;
    }
    async getCode(phoneNumber) {
        const raw = await this.redis.get(KEY_PREFIX.code + phoneNumber);
        return raw ? JSON.parse(raw) : undefined;
    }
    async setCode(phoneNumber, rec) {
        // TTL = 有效期 + 60s 缓冲，保证「已过期但可区分」与「不存在」两种失败语义
        const ttl = Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000) + 60);
        await this.redis.set(KEY_PREFIX.code + phoneNumber, JSON.stringify(rec), 'EX', ttl);
    }
    async deleteCode(phoneNumber) {
        await this.redis.del(KEY_PREFIX.code + phoneNumber);
    }
    async isCoolingDown(phoneNumber) {
        return (await this.redis.exists(KEY_PREFIX.cooldown + phoneNumber)) === 1;
    }
    async markSent(phoneNumber, cooldownMs) {
        await this.redis.set(KEY_PREFIX.cooldown + phoneNumber, '1', 'PX', cooldownMs);
    }
    async incrDaily(phoneNumber, dayKey) {
        const key = KEY_PREFIX.daily + `${phoneNumber}:${dayKey}`;
        return (await this.redis.eval(LUA_INCR_DAILY, 1, key, 25 * 3600));
    }
}
let SmsService = class SmsService {
    constructor(options) {
        this.signName = options.signName;
        this.templateCode = options.templateCode;
        this.codeLength = options.codeLength || 6;
        this.codeExpirySeconds = options.codeExpirySeconds || 300;
        this.clients = new Map();
        // 生产环境强制关闭 devBypass 后门（防环境变量误配导致任意手机号接管账号）
        this.devBypass = options.devBypass || false;
        if (this.devBypass && process.env.NODE_ENV === 'production') {
            core_1.Logger.warn('devBypass is ignored in production', constants_1.loggerCtx);
            this.devBypass = false;
        }
        this.devBypassCode = options.devBypassCode || '123456';
        if (options.redisUrl) {
            const redis = new ioredis_1.default(options.redisUrl, {
                lazyConnect: false,
                maxRetriesPerRequest: 2,
            });
            redis.on('error', (e) => core_1.Logger.error(`phone-auth Redis error: ${e.message}`, constants_1.loggerCtx));
            this.store = new RedisStore(redis);
            this.inMemoryStore = new InMemoryStore(); // 仅用于 dayKey 工具
            core_1.Logger.info('phone-auth: using Redis-backed code store', constants_1.loggerCtx);
        }
        else {
            this.inMemoryStore = new InMemoryStore();
            this.store = this.inMemoryStore;
        }
    }
    /** 判定能否立即发码；返回 null 表示放行，否则返回拒绝原因（供日志） */
    async checkRateLimit(phoneNumber) {
        if (this.store === this.inMemoryStore)
            this.inMemoryStore.sweep();
        if (await this.store.isCoolingDown(phoneNumber)) {
            return 'cooldown';
        }
        const sentToday = await this.store.incrDaily(phoneNumber, this.inMemoryStore.dayKey());
        if (sentToday > DAILY_SEND_LIMIT) {
            // check 即占额（防滥用优先于精确计数；被拒绝的尝试同样消耗当日额度）
            return 'daily-limit';
        }
        return null;
    }
    async sendVerificationCode(phoneNumber, credentials) {
        var _a, _b;
        const code = this.generateCode();
        await this.store.setCode(phoneNumber, {
            code,
            expiresAt: Date.now() + this.codeExpirySeconds * 1000,
            failures: 0,
        });
        await this.store.markSent(phoneNumber, SEND_COOLDOWN_MS);
        if (this.devBypass) {
            core_1.Logger.info(`[DEV BYPASS] Verification code for ${maskPhone(phoneNumber)}: ${code}`, constants_1.loggerCtx);
            return true;
        }
        const creds = credentials || {
            accessKeyId: '',
            accessKeySecret: '',
            signName: this.signName,
            templateCode: this.templateCode,
        };
        // 兜底凭证缺失（未配置短信/租户覆盖也不完整）时，验证码仅存内存不发真实短信
        if (!creds.accessKeyId || !creds.accessKeySecret) {
            core_1.Logger.warn(`SMS credentials missing, code stored without sending (${maskPhone(phoneNumber)})`, constants_1.loggerCtx);
            return false;
        }
        try {
            const client = this.getClient(creds);
            const request = new dysmsapi20170525_1.SendSmsRequest({
                phoneNumbers: phoneNumber,
                signName: creds.signName,
                templateCode: creds.templateCode,
                templateParam: JSON.stringify({ code }),
            });
            const result = await client.sendSms(request);
            if (((_a = result.body) === null || _a === void 0 ? void 0 : _a.code) === 'OK') {
                core_1.Logger.info(`SMS sent to ${maskPhone(phoneNumber)}`, constants_1.loggerCtx);
                return true;
            }
            core_1.Logger.error(`SMS send failed: ${(_b = result.body) === null || _b === void 0 ? void 0 : _b.message}`, constants_1.loggerCtx);
            return false;
        }
        catch (e) {
            core_1.Logger.error(`SMS send error: ${e.message}`, constants_1.loggerCtx);
            return false;
        }
    }
    async verifyCode(phoneNumber, code) {
        const stored = await this.store.getCode(phoneNumber);
        if (!stored)
            return false;
        if (Date.now() > stored.expiresAt) {
            await this.store.deleteCode(phoneNumber);
            return false;
        }
        // 连续失败超过阈值则作废当前验证码（防 6 位码暴力枚举），需重新发码
        if (stored.code === code) {
            await this.store.deleteCode(phoneNumber);
            return true;
        }
        // devBypass 判定须在失败计数之前：bypass 成功不应消耗失败次数，也避免先回写再删除
        if (this.devBypass && code === this.devBypassCode) {
            await this.store.deleteCode(phoneNumber);
            core_1.Logger.info(`[DEV BYPASS] Accepted bypass code for ${maskPhone(phoneNumber)}`, constants_1.loggerCtx);
            return true;
        }
        stored.failures += 1;
        if (stored.failures >= MAX_VERIFY_FAILURES) {
            await this.store.deleteCode(phoneNumber);
            core_1.Logger.warn(`Verification code invalidated after ${stored.failures} failures (${maskPhone(phoneNumber)})`, constants_1.loggerCtx);
            return false;
        }
        await this.store.setCode(phoneNumber, stored);
        return false;
    }
    /** devBypass 透传（registerCustomer 等调用方需要知道验证流程是否在旁路模式） */
    isDevBypass() {
        return this.devBypass;
    }
    getClient(creds) {
        const fingerprint = `${creds.accessKeyId}:${creds.accessKeySecret}`;
        let client = this.clients.get(fingerprint);
        if (!client) {
            client = new dysmsapi20170525_1.default(new openapi_client_1.Config({
                accessKeyId: creds.accessKeyId,
                accessKeySecret: creds.accessKeySecret,
                endpoint: 'dysmsapi.aliyuncs.com',
            }));
            this.clients.set(fingerprint, client);
        }
        return client;
    }
    generateCode() {
        let code = '';
        for (let i = 0; i < this.codeLength; i++) {
            code += String((0, node_crypto_1.randomInt)(0, 10));
        }
        return code;
    }
};
exports.SmsService = SmsService;
exports.SmsService = SmsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [Object])
], SmsService);
//# sourceMappingURL=sms.service.js.map