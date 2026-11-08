import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Logger, TransactionalConnection } from '@vendure/core';
import { PeriodicFallback } from './periodic-fallback';

const loggerCtx = 'CampusDedupe';
/** DB 过期行清理周期：5 分钟（只是防止表无限增长，不影响语义） */
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const CLEANUP_BOOT_DELAY_MS = 60_000;
const DEFAULT_TTL_MS = 10 * 60_000;

export type CampusDedupeDriver = 'memory' | 'db' | 'redis';

interface MemoryEntry {
    expiresAt: number;
    counter: number;
    value: unknown;
}

/**
 * 跨实例去重/限频（M4）。
 *
 * 插件里大量「冷却/限频/待确认」状态原先放在进程内 Map：
 * 单实例够用，多实例（pm2 cluster / 容器多副本）下每个进程各算各的，
 * 冷却形同虚设（同一告警会被多个实例重复推送）。本服务把状态收敛到统一后端：
 *
 * - memory：进程内 Map（默认；单实例/单测）；
 * - db：`campus_dedupe_key` 表（Postgres，p38 迁移建表；跨实例共享）；
 * - redis：`CAMPUS_DEDUPE_DRIVER=redis` 且已安装 redis 客户端时使用，失败回退 db。
 *
 * 语义约定（调用方据此替换原 Map 逻辑）：
 * - `seen(key, ttl)`：只读判断是否仍在窗口内，不写入（用于「是否重复」的前置检查）；
 * - `mark(key, ttl)`：写入/续期窗口（用于送达成功后才开始冷却）；
 * - `seenOrMark(key, ttl)`：原子「查并写」，返回 true 表示窗口内已存在（用于告警限频）；
 * - `incr(key, windowMs)`：窗口内计数 +1（窗口过期重新从 1 开始），返回当前次数；
 * - `setJson/getJson/del`：带 TTL 的任意状态（飞书待确认指令等）。
 *
 * 所有方法都不会抛异常：后端不可用时降级为内存实现（只记一次日志），
 * 保证去重/限频失效也绝不阻断主流程。
 */
@Injectable()
export class CampusDedupeService implements OnApplicationShutdown {
    private readonly memory = new Map<string, MemoryEntry>();
    private readonly driver: CampusDedupeDriver;
    private readonly instanceCount: number;
    private redis: any = null;
    private redisLoading: Promise<any> | null = null;
    private redisBroken = false;
    private dbBroken = false;
    private cleanup: PeriodicFallback | null = null;

    constructor(private connection: TransactionalConnection) {
        const configured = String(process.env.CAMPUS_DEDUPE_DRIVER ?? '').toLowerCase();
        const rawType = String((this.connection as any)?.rawConnection?.options?.type ?? '').toLowerCase();
        this.instanceCount = Math.max(1, Number(process.env.CAMPUS_INSTANCE_COUNT ?? 1) || 1);
        if (configured === 'memory' || configured === 'db' || configured === 'redis') {
            this.driver = configured as CampusDedupeDriver;
        } else {
            // 未显式配置：Postgres 生产默认走 DB（天然跨实例），其余（sqlite 单测/dev）走内存
            this.driver = rawType === 'postgres' ? 'db' : 'memory';
        }
        if (this.driver === 'memory' && this.instanceCount > 1) {
            Logger.warn(
                `CAMPUS_INSTANCE_COUNT=${this.instanceCount} 但去重后端为 memory：跨实例冷却/限频会失效，` +
                    `建议设置 CAMPUS_DEDUPE_DRIVER=db`,
                loggerCtx,
            );
        }
        // 启动可观测性：部署校验据此确认显式配置生效（db 后端跨实例共享）
        Logger.info(`跨实例去重后端：${this.driver}（实例数 ${this.instanceCount}）`, loggerCtx);
        if (this.driver !== 'memory') {
            this.cleanup = new PeriodicFallback({
                name: 'campus-dedupe-cleanup',
                intervalMs: CLEANUP_INTERVAL_MS,
                bootDelayMs: CLEANUP_BOOT_DELAY_MS,
                loggerCtx,
            });
            this.cleanup.start(() => this.cleanupOnce());
        }
    }

    onApplicationShutdown(): void {
        this.cleanup?.stop();
        this.cleanup = null;
        const client = this.redis;
        this.redis = null;
        void client?.quit?.().catch(() => undefined);
    }

    get backend(): CampusDedupeDriver {
        return this.driver === 'redis' && (this.redisBroken || !this.redis) ? 'db' : this.driver;
    }

    async seen(key: string, ttlMs = DEFAULT_TTL_MS): Promise<boolean> {
        if (this.driver === 'memory') return this.memorySeen(key);
        if (this.driver === 'redis') {
            const r = await this.withRedis(client => client.get(key));
            if (r !== undefined) return r != null;
        }
        return this.dbSeen(key);
    }

    async mark(key: string, ttlMs = DEFAULT_TTL_MS): Promise<void> {
        if (this.driver === 'memory') {
            this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value: undefined });
            return;
        }
        if (this.driver === 'redis') {
            const ok = await this.withRedis(client => client.set(key, '1', { PX: ttlMs }));
            if (ok !== undefined) return;
        }
        await this.dbMark(key, ttlMs);
    }

    /** 返回 true 表示窗口内已存在（本次不再执行）；false 表示本次抢占成功 */
    async seenOrMark(key: string, ttlMs = DEFAULT_TTL_MS): Promise<boolean> {
        if (this.driver === 'memory') {
            const hit = this.memorySeen(key);
            if (!hit) this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value: undefined });
            return hit;
        }
        if (this.driver === 'redis') {
            const r = await this.withRedis(client => client.set(key, '1', { PX: ttlMs, NX: true }));
            if (r !== undefined) return r == null;
        }
        return this.dbSeenOrMark(key, ttlMs);
    }

    /** 窗口内计数（过期自动重置为 1） */
    async incr(key: string, windowMs = DEFAULT_TTL_MS): Promise<number> {
        if (this.driver === 'memory') {
            const cur = this.memory.get(key);
            if (cur && cur.expiresAt > Date.now()) {
                cur.counter += 1;
                return cur.counter;
            }
            this.memorySet(key, { expiresAt: Date.now() + windowMs, counter: 1, value: undefined });
            return 1;
        }
        if (this.driver === 'redis') {
            const n = await this.withRedis(async client => {
                const count = Number(await client.incr(key));
                if (count === 1) await client.pExpire(key, windowMs);
                return count;
            });
            if (n !== undefined) return n;
        }
        return this.dbIncr(key, windowMs);
    }

    async setJson(key: string, value: unknown, ttlMs = DEFAULT_TTL_MS): Promise<void> {
        if (this.driver === 'memory') {
            this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value });
            return;
        }
        if (this.driver === 'redis') {
            const ok = await this.withRedis(client => client.set(key, JSON.stringify(value ?? null), { PX: ttlMs }));
            if (ok !== undefined) return;
        }
        await this.dbSetJson(key, value, ttlMs);
    }

    async getJson<T = unknown>(key: string): Promise<T | null> {
        if (this.driver === 'memory') {
            const cur = this.validMemory(key);
            return cur ? ((cur.value ?? null) as T | null) : null;
        }
        if (this.driver === 'redis') {
            const raw = await this.withRedis(client => client.get(key));
            if (raw !== undefined) {
                if (raw == null) return null;
                try {
                    return JSON.parse(String(raw)) as T;
                } catch {
                    return null;
                }
            }
        }
        return this.dbGetJson<T>(key);
    }

    async del(key: string): Promise<void> {
        this.memory.delete(key);
        if (this.driver === 'memory') return;
        if (this.driver === 'redis') {
            const ok = await this.withRedis(client => client.del(key));
            if (ok !== undefined) return;
        }
        try {
            await this.raw().query(`DELETE FROM campus_dedupe_key WHERE "key"=$1`, [key]);
        } catch (e: any) {
            this.warnDbOnce(e);
        }
    }

    // ---------------------------------------------------------------- memory

    private validMemory(key: string): MemoryEntry | null {
        const cur = this.memory.get(key);
        if (!cur) return null;
        if (cur.expiresAt <= Date.now()) {
            this.memory.delete(key);
            return null;
        }
        return cur;
    }

    private memorySeen(key: string): boolean {
        return this.validMemory(key) != null;
    }

    private memorySet(key: string, entry: MemoryEntry): void {
        this.memory.set(key, entry);
    }

    // -------------------------------------------------------------------- db

    private raw(): any {
        return (this.connection as any).rawConnection;
    }

    private rows(result: any): any[] {
        return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : Array.isArray(result) ? result : [];
    }

    private async dbSeen(key: string): Promise<boolean> {
        try {
            const result = await this.raw().query(
                `SELECT 1 AS "hit" FROM campus_dedupe_key WHERE "key"=$1 AND "expiresAt" > now()`,
                [key],
            );
            return this.rows(result).length > 0;
        } catch (e: any) {
            this.warnDbOnce(e);
            return this.memorySeen(key);
        }
    }

    private async dbMark(key: string, ttlMs: number): Promise<void> {
        try {
            // TTL 毫秒按 bigint 传入：int32 上限约 24.8 天，10 年级别的标记（如退款重试安装时间）会溢出报错
            await this.raw().query(
                `INSERT INTO campus_dedupe_key ("key", "expiresAt", "counter")
                 VALUES ($1, now() + ($2::bigint * interval '1 millisecond'), 0)
                 ON CONFLICT ("key") DO UPDATE SET "expiresAt"=excluded."expiresAt"`,
                [key, Math.max(1, Math.floor(ttlMs))],
            );
        } catch (e: any) {
            this.warnDbOnce(e);
            this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value: undefined });
        }
    }

    private async dbSeenOrMark(key: string, ttlMs: number): Promise<boolean> {
        try {
            // 先清掉过期行，避免过期 key 的冲突被误判为「窗口内已存在」
            await this.raw().query(`DELETE FROM campus_dedupe_key WHERE "key"=$1 AND "expiresAt" <= now()`, [key]);
            const result = await this.raw().query(
                `INSERT INTO campus_dedupe_key ("key", "expiresAt", "counter")
                 VALUES ($1, now() + ($2::bigint * interval '1 millisecond'), 0)
                 ON CONFLICT ("key") DO NOTHING
                 RETURNING "key"`,
                [key, Math.max(1, Math.floor(ttlMs))],
            );
            // 抢占成功（有返回行）→ 不是重复；冲突（无返回行）→ 已存在
            return this.rows(result).length === 0;
        } catch (e: any) {
            this.warnDbOnce(e);
            const hit = this.memorySeen(key);
            if (!hit) this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value: undefined });
            return hit;
        }
    }

    private async dbIncr(key: string, windowMs: number): Promise<number> {
        try {
            const result = await this.raw().query(
                `INSERT INTO campus_dedupe_key ("key", "expiresAt", "counter")
                 VALUES ($1, now() + ($2::bigint * interval '1 millisecond'), 1)
                 ON CONFLICT ("key") DO UPDATE SET
                     "counter" = CASE WHEN campus_dedupe_key."expiresAt" <= now()
                                      THEN 1 ELSE campus_dedupe_key."counter" + 1 END,
                     "expiresAt" = CASE WHEN campus_dedupe_key."expiresAt" <= now()
                                        THEN excluded."expiresAt" ELSE campus_dedupe_key."expiresAt" END
                 RETURNING "counter"`,
                [key, Math.max(1, Math.floor(windowMs))],
            );
            const row = this.rows(result)[0];
            return Number(row?.counter) || 1;
        } catch (e: any) {
            this.warnDbOnce(e);
            const cur = this.memory.get(key);
            if (cur && cur.expiresAt > Date.now()) {
                cur.counter += 1;
                return cur.counter;
            }
            this.memorySet(key, { expiresAt: Date.now() + windowMs, counter: 1, value: undefined });
            return 1;
        }
    }

    private async dbSetJson(key: string, value: unknown, ttlMs: number): Promise<void> {
        try {
            await this.raw().query(
                `INSERT INTO campus_dedupe_key ("key", "expiresAt", "counter", "value")
                 VALUES ($1, now() + ($2::bigint * interval '1 millisecond'), 0, $3::jsonb)
                 ON CONFLICT ("key") DO UPDATE SET
                     "expiresAt"=excluded."expiresAt", "value"=excluded."value"`,
                [key, Math.max(1, Math.floor(ttlMs)), JSON.stringify(value ?? null)],
            );
        } catch (e: any) {
            this.warnDbOnce(e);
            this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value });
        }
    }

    private async dbGetJson<T>(key: string): Promise<T | null> {
        try {
            const result = await this.raw().query(
                `SELECT "value" FROM campus_dedupe_key WHERE "key"=$1 AND "expiresAt" > now()`,
                [key],
            );
            const row = this.rows(result)[0];
            if (!row) return null;
            const value = row.value;
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value) as T;
                } catch {
                    return null;
                }
            }
            return (value ?? null) as T | null;
        } catch (e: any) {
            this.warnDbOnce(e);
            const cur = this.validMemory(key);
            return cur ? ((cur.value ?? null) as T | null) : null;
        }
    }

    /** 首次失败记一次告警（后续静默，避免刷屏） */
    private warnDbOnce(e: any): void {
        if (this.dbBroken) return;
        this.dbBroken = true;
        Logger.warn(
            `去重表不可用（降级为进程内内存，跨实例冷却将失效）：${String(e?.message ?? e)}`,
            loggerCtx,
        );
    }

    // ----------------------------------------------------------------- redis

    private async withRedis<T>(fn: (client: any) => Promise<T>): Promise<T | undefined> {
        const client = await this.redisClient();
        if (!client) return undefined;
        try {
            return await fn(client);
        } catch (e: any) {
            this.redisBroken = true;
            Logger.warn(`redis 去重后端失败（回退 db）：${String(e?.message ?? e)}`, loggerCtx);
            return undefined;
        }
    }

    private async redisClient(): Promise<any | null> {
        if (this.redisBroken) return null;
        if (this.redis) return this.redis;
        if (!this.redisLoading) {
            this.redisLoading = (async () => {
                try {
                    // 动态加载：未安装 redis 包时不阻塞插件启动
                    const mod = require('redis');
                    const client = mod.createClient({ url: process.env.CAMPUS_REDIS_URL || 'redis://127.0.0.1:6379' });
                    client.on?.('error', (e: any) =>
                        Logger.warn(`redis 连接错误：${String(e?.message ?? e)}`, loggerCtx),
                    );
                    await client.connect();
                    this.redis = client;
                    return client;
                } catch (e: any) {
                    this.redisBroken = true;
                    Logger.warn(
                        `redis 不可用（回退 db）：${String(e?.message ?? e)}；如需启用请安装 redis 并配置 CAMPUS_REDIS_URL`,
                        loggerCtx,
                    );
                    return null;
                }
            })();
        }
        return this.redisLoading;
    }

    // --------------------------------------------------------------- cleanup

    private async cleanupOnce(): Promise<void> {
        if (this.driver === 'memory') {
            const now = Date.now();
            for (const [key, entry] of this.memory) {
                if (entry.expiresAt <= now) this.memory.delete(key);
            }
            return;
        }
        try {
            await this.raw().query(`DELETE FROM campus_dedupe_key WHERE "expiresAt" <= now()`);
        } catch (e: any) {
            this.warnDbOnce(e);
        }
    }
}
