import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import Dysmsapi, { SendSmsRequest } from '@alicloud/dysmsapi20170525';
import OpenApiClient, { Config } from '@alicloud/openapi-client';
import { Logger } from '@vendure/core';
import Redis from 'ioredis';

import { loggerCtx } from './constants';
import { PhoneAuthPluginOptions } from './types';

/** 单次发码使用的有效凭证（全局 options 或租户覆盖解析结果） */
export interface SmsCredentials {
    accessKeyId: string;
    accessKeySecret: string;
    signName: string;
    templateCode: string;
}

const SEND_COOLDOWN_MS = 60_000; // 同号发码冷却
const DAILY_SEND_LIMIT = 10; // 同号每日发码上限

/** 日志脱敏：手机号仅保留前 3 后 2 位 */
function maskPhone(phoneNumber: string): string {
    if (!phoneNumber || phoneNumber.length <= 5) {
        return '****';
    }
    return `${phoneNumber.slice(0, 3)}****${phoneNumber.slice(-2)}`;
}
const MAX_VERIFY_FAILURES = 5; // 同一验证码连续失败 N 次后作废

export interface StoredCode {
    code: string;
    expiresAt: number;
    failures: number;
}

/**
 * 验证码/限流状态存储抽象。
 * 单实例用进程内存（InMemoryStore）；配置 redisUrl 后用 Redis（多实例共享，TTL 自动过期）。
 */
interface CodeStore {
    getCode(phoneNumber: string): Promise<StoredCode | undefined>;
    setCode(phoneNumber: string, rec: StoredCode): Promise<void>;
    deleteCode(phoneNumber: string): Promise<void>;
    isCoolingDown(phoneNumber: string): Promise<boolean>;
    markSent(phoneNumber: string, cooldownMs: number): Promise<void>;
    /** 当日计数自增并返回新值（首次调用设置当日过期） */
    incrDaily(phoneNumber: string, dayKey: string): Promise<number>;
}

class InMemoryStore implements CodeStore {
    private codes = new Map<string, StoredCode>();
    private cooldowns = new Map<string, number>();
    private daily = new Map<string, number>();

    async getCode(phoneNumber: string): Promise<StoredCode | undefined> {
        return this.codes.get(phoneNumber);
    }

    async setCode(phoneNumber: string, rec: StoredCode): Promise<void> {
        this.codes.set(phoneNumber, rec);
    }

    async deleteCode(phoneNumber: string): Promise<void> {
        this.codes.delete(phoneNumber);
    }

    async isCoolingDown(phoneNumber: string): Promise<boolean> {
        const last = this.cooldowns.get(phoneNumber);
        return !!last && Date.now() - last < SEND_COOLDOWN_MS;
    }

    async markSent(phoneNumber: string): Promise<void> {
        this.cooldowns.set(phoneNumber, Date.now());
    }

    async incrDaily(phoneNumber: string, dayKey: string): Promise<number> {
        const key = `${phoneNumber}:${dayKey}`;
        const next = (this.daily.get(key) || 0) + 1;
        this.daily.set(key, next);
        return next;
    }

    /** 惰性清理：该号过期验证码 + 全局容量兜底（Redis 实现靠 TTL，无需此步） */
    sweep(): void {
        const now = Date.now();
        if (this.codes.size > 10_000) {
            for (const [k, v] of this.codes) {
                if (now > v.expiresAt) this.codes.delete(k);
            }
        }
        if (this.cooldowns.size > 10_000) {
            for (const [k, t] of this.cooldowns) {
                if (now - t >= SEND_COOLDOWN_MS) this.cooldowns.delete(k);
            }
        }
        if (this.daily.size > 50_000) {
            const today = this.dayKey();
            for (const k of this.daily.keys()) {
                if (!k.endsWith(`:${today}`)) this.daily.delete(k);
            }
        }
    }

    dayKey(): string {
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

class RedisStore implements CodeStore {
    constructor(private redis: Redis) {}

    async getCode(phoneNumber: string): Promise<StoredCode | undefined> {
        const raw = await this.redis.get(KEY_PREFIX.code + phoneNumber);
        return raw ? (JSON.parse(raw) as StoredCode) : undefined;
    }

    async setCode(phoneNumber: string, rec: StoredCode): Promise<void> {
        // TTL = 有效期 + 60s 缓冲，保证「已过期但可区分」与「不存在」两种失败语义
        const ttl = Math.max(1, Math.ceil((rec.expiresAt - Date.now()) / 1000) + 60);
        await this.redis.set(KEY_PREFIX.code + phoneNumber, JSON.stringify(rec), 'EX', ttl);
    }

    async deleteCode(phoneNumber: string): Promise<void> {
        await this.redis.del(KEY_PREFIX.code + phoneNumber);
    }

    async isCoolingDown(phoneNumber: string): Promise<boolean> {
        return (await this.redis.exists(KEY_PREFIX.cooldown + phoneNumber)) === 1;
    }

    async markSent(phoneNumber: string, cooldownMs: number): Promise<void> {
        await this.redis.set(KEY_PREFIX.cooldown + phoneNumber, '1', 'PX', cooldownMs);
    }

    async incrDaily(phoneNumber: string, dayKey: string): Promise<number> {
        const key = KEY_PREFIX.daily + `${phoneNumber}:${dayKey}`;
        return (await this.redis.eval(LUA_INCR_DAILY, 1, key, 25 * 3600)) as number;
    }
}

@Injectable()
export class SmsService {
    private signName: string;
    private templateCode: string;
    private codeLength: number;
    private codeExpirySeconds: number;

    private store: CodeStore;
    private inMemoryStore: InMemoryStore;

    /** 按凭证指纹缓存的阿里云客户端（支持租户级凭证覆盖） */
    private clients: Map<string, Dysmsapi>;

    private devBypass: boolean;
    private devBypassCode: string;

    constructor(options: PhoneAuthPluginOptions) {
        this.signName = options.signName;
        this.templateCode = options.templateCode;
        this.codeLength = options.codeLength || 6;
        this.codeExpirySeconds = options.codeExpirySeconds || 300;
        this.clients = new Map();
        // 生产环境强制关闭 devBypass 后门（防环境变量误配导致任意手机号接管账号）
        this.devBypass = options.devBypass || false;
        if (this.devBypass && process.env.NODE_ENV === 'production') {
            Logger.warn('devBypass is ignored in production', loggerCtx);
            this.devBypass = false;
        }
        this.devBypassCode = options.devBypassCode || '123456';

        if (options.redisUrl) {
            const redis = new Redis(options.redisUrl, {
                lazyConnect: false,
                maxRetriesPerRequest: 2,
            });
            redis.on('error', (e) => Logger.error(`phone-auth Redis error: ${e.message}`, loggerCtx));
            this.store = new RedisStore(redis);
            this.inMemoryStore = new InMemoryStore(); // 仅用于 dayKey 工具
            Logger.info('phone-auth: using Redis-backed code store', loggerCtx);
        } else {
            this.inMemoryStore = new InMemoryStore();
            this.store = this.inMemoryStore;
        }
    }

    /** 判定能否立即发码；返回 null 表示放行，否则返回拒绝原因（供日志） */
    async checkRateLimit(phoneNumber: string): Promise<string | null> {
        if (this.store === this.inMemoryStore) this.inMemoryStore.sweep();
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

    async sendVerificationCode(phoneNumber: string, credentials?: SmsCredentials): Promise<boolean> {
        const code = this.generateCode();
        await this.store.setCode(phoneNumber, {
            code,
            expiresAt: Date.now() + this.codeExpirySeconds * 1000,
            failures: 0,
        });
        await this.store.markSent(phoneNumber, SEND_COOLDOWN_MS);

        if (this.devBypass) {
            Logger.info(`[DEV BYPASS] Verification code for ${maskPhone(phoneNumber)}: ${code}`, loggerCtx);
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
            Logger.warn(`SMS credentials missing, code stored without sending (${maskPhone(phoneNumber)})`, loggerCtx);
            return false;
        }

        try {
            const client = this.getClient(creds);
            const request = new SendSmsRequest({
                phoneNumbers: phoneNumber,
                signName: creds.signName,
                templateCode: creds.templateCode,
                templateParam: JSON.stringify({ code }),
            });
            const result = await client.sendSms(request);

            if (result.body?.code === 'OK') {
                Logger.info(`SMS sent to ${maskPhone(phoneNumber)}`, loggerCtx);
                return true;
            }

            Logger.error(`SMS send failed: ${result.body?.message}`, loggerCtx);
            return false;
        } catch (e: any) {
            Logger.error(`SMS send error: ${e.message}`, loggerCtx);
            return false;
        }
    }

    async verifyCode(phoneNumber: string, code: string): Promise<boolean> {
        const stored = await this.store.getCode(phoneNumber);
        if (!stored) return false;
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
            Logger.info(`[DEV BYPASS] Accepted bypass code for ${maskPhone(phoneNumber)}`, loggerCtx);
            return true;
        }
        stored.failures += 1;
        if (stored.failures >= MAX_VERIFY_FAILURES) {
            await this.store.deleteCode(phoneNumber);
            Logger.warn(`Verification code invalidated after ${stored.failures} failures (${maskPhone(phoneNumber)})`, loggerCtx);
            return false;
        }
        await this.store.setCode(phoneNumber, stored);
        return false;
    }

    /** devBypass 透传（registerCustomer 等调用方需要知道验证流程是否在旁路模式） */
    isDevBypass(): boolean {
        return this.devBypass;
    }

    private getClient(creds: SmsCredentials): Dysmsapi {
        const fingerprint = `${creds.accessKeyId}:${creds.accessKeySecret}`;
        let client = this.clients.get(fingerprint);
        if (!client) {
            client = new Dysmsapi(
                new Config({
                    accessKeyId: creds.accessKeyId,
                    accessKeySecret: creds.accessKeySecret,
                    endpoint: 'dysmsapi.aliyuncs.com',
                }),
            );
            this.clients.set(fingerprint, client);
        }
        return client;
    }

    private generateCode(): string {
        let code = '';
        for (let i = 0; i < this.codeLength; i++) {
            code += String(randomInt(0, 10));
        }
        return code;
    }
}
