"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CampusDedupeService = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const periodic_fallback_1 = require("./periodic-fallback");
const loggerCtx = 'CampusDedupe';
/** DB 过期行清理周期：5 分钟（只是防止表无限增长，不影响语义） */
const CLEANUP_INTERVAL_MS = 5 * 60000;
const CLEANUP_BOOT_DELAY_MS = 60000;
const DEFAULT_TTL_MS = 10 * 60000;
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
let CampusDedupeService = class CampusDedupeService {
    constructor(connection) {
        var _a, _b, _c, _d, _e, _f;
        this.connection = connection;
        this.memory = new Map();
        this.redis = null;
        this.redisLoading = null;
        this.redisBroken = false;
        this.dbBroken = false;
        this.cleanup = null;
        const configured = String((_a = process.env.CAMPUS_DEDUPE_DRIVER) !== null && _a !== void 0 ? _a : '').toLowerCase();
        const rawType = String((_e = (_d = (_c = (_b = this.connection) === null || _b === void 0 ? void 0 : _b.rawConnection) === null || _c === void 0 ? void 0 : _c.options) === null || _d === void 0 ? void 0 : _d.type) !== null && _e !== void 0 ? _e : '').toLowerCase();
        this.instanceCount = Math.max(1, Number((_f = process.env.CAMPUS_INSTANCE_COUNT) !== null && _f !== void 0 ? _f : 1) || 1);
        if (configured === 'memory' || configured === 'db' || configured === 'redis') {
            this.driver = configured;
        }
        else {
            // 未显式配置：Postgres 生产默认走 DB（天然跨实例），其余（sqlite 单测/dev）走内存
            this.driver = rawType === 'postgres' ? 'db' : 'memory';
        }
        if (this.driver === 'memory' && this.instanceCount > 1) {
            core_1.Logger.warn(`CAMPUS_INSTANCE_COUNT=${this.instanceCount} 但去重后端为 memory：跨实例冷却/限频会失效，` +
                `建议设置 CAMPUS_DEDUPE_DRIVER=db`, loggerCtx);
        }
        // 启动可观测性：部署校验据此确认显式配置生效（db 后端跨实例共享）
        core_1.Logger.info(`跨实例去重后端：${this.driver}（实例数 ${this.instanceCount}）`, loggerCtx);
        if (this.driver !== 'memory') {
            this.cleanup = new periodic_fallback_1.PeriodicFallback({
                name: 'campus-dedupe-cleanup',
                intervalMs: CLEANUP_INTERVAL_MS,
                bootDelayMs: CLEANUP_BOOT_DELAY_MS,
                loggerCtx,
            });
            this.cleanup.start(() => this.cleanupOnce());
        }
    }
    onApplicationShutdown() {
        var _a, _b;
        (_a = this.cleanup) === null || _a === void 0 ? void 0 : _a.stop();
        this.cleanup = null;
        const client = this.redis;
        this.redis = null;
        void ((_b = client === null || client === void 0 ? void 0 : client.quit) === null || _b === void 0 ? void 0 : _b.call(client).catch(() => undefined));
    }
    get backend() {
        return this.driver === 'redis' && (this.redisBroken || !this.redis) ? 'db' : this.driver;
    }
    async seen(key, ttlMs = DEFAULT_TTL_MS) {
        if (this.driver === 'memory')
            return this.memorySeen(key);
        if (this.driver === 'redis') {
            const r = await this.withRedis(client => client.get(key));
            if (r !== undefined)
                return r != null;
        }
        return this.dbSeen(key);
    }
    async mark(key, ttlMs = DEFAULT_TTL_MS) {
        if (this.driver === 'memory') {
            this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value: undefined });
            return;
        }
        if (this.driver === 'redis') {
            const ok = await this.withRedis(client => client.set(key, '1', { PX: ttlMs }));
            if (ok !== undefined)
                return;
        }
        await this.dbMark(key, ttlMs);
    }
    /** 返回 true 表示窗口内已存在（本次不再执行）；false 表示本次抢占成功 */
    async seenOrMark(key, ttlMs = DEFAULT_TTL_MS) {
        if (this.driver === 'memory') {
            const hit = this.memorySeen(key);
            if (!hit)
                this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value: undefined });
            return hit;
        }
        if (this.driver === 'redis') {
            const r = await this.withRedis(client => client.set(key, '1', { PX: ttlMs, NX: true }));
            if (r !== undefined)
                return r == null;
        }
        return this.dbSeenOrMark(key, ttlMs);
    }
    /** 窗口内计数（过期自动重置为 1） */
    async incr(key, windowMs = DEFAULT_TTL_MS) {
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
            const n = await this.withRedis(async (client) => {
                const count = Number(await client.incr(key));
                if (count === 1)
                    await client.pExpire(key, windowMs);
                return count;
            });
            if (n !== undefined)
                return n;
        }
        return this.dbIncr(key, windowMs);
    }
    async setJson(key, value, ttlMs = DEFAULT_TTL_MS) {
        if (this.driver === 'memory') {
            this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value });
            return;
        }
        if (this.driver === 'redis') {
            const ok = await this.withRedis(client => client.set(key, JSON.stringify(value !== null && value !== void 0 ? value : null), { PX: ttlMs }));
            if (ok !== undefined)
                return;
        }
        await this.dbSetJson(key, value, ttlMs);
    }
    async getJson(key) {
        var _a;
        if (this.driver === 'memory') {
            const cur = this.validMemory(key);
            return cur ? ((_a = cur.value) !== null && _a !== void 0 ? _a : null) : null;
        }
        if (this.driver === 'redis') {
            const raw = await this.withRedis(client => client.get(key));
            if (raw !== undefined) {
                if (raw == null)
                    return null;
                try {
                    return JSON.parse(String(raw));
                }
                catch (_b) {
                    return null;
                }
            }
        }
        return this.dbGetJson(key);
    }
    async del(key) {
        this.memory.delete(key);
        if (this.driver === 'memory')
            return;
        if (this.driver === 'redis') {
            const ok = await this.withRedis(client => client.del(key));
            if (ok !== undefined)
                return;
        }
        try {
            await this.raw().query(`DELETE FROM campus_dedupe_key WHERE "key"=$1`, [key]);
        }
        catch (e) {
            this.warnDbOnce(e);
        }
    }
    // ---------------------------------------------------------------- memory
    validMemory(key) {
        const cur = this.memory.get(key);
        if (!cur)
            return null;
        if (cur.expiresAt <= Date.now()) {
            this.memory.delete(key);
            return null;
        }
        return cur;
    }
    memorySeen(key) {
        return this.validMemory(key) != null;
    }
    memorySet(key, entry) {
        this.memory.set(key, entry);
    }
    // -------------------------------------------------------------------- db
    raw() {
        return this.connection.rawConnection;
    }
    rows(result) {
        return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : Array.isArray(result) ? result : [];
    }
    async dbSeen(key) {
        try {
            const result = await this.raw().query(`SELECT 1 AS "hit" FROM campus_dedupe_key WHERE "key"=$1 AND "expiresAt" > now()`, [key]);
            return this.rows(result).length > 0;
        }
        catch (e) {
            this.warnDbOnce(e);
            return this.memorySeen(key);
        }
    }
    async dbMark(key, ttlMs) {
        try {
            // TTL 毫秒按 bigint 传入：int32 上限约 24.8 天，10 年级别的标记（如退款重试安装时间）会溢出报错
            await this.raw().query(`INSERT INTO campus_dedupe_key ("key", "expiresAt", "counter")
                 VALUES ($1, now() + ($2::bigint * interval '1 millisecond'), 0)
                 ON CONFLICT ("key") DO UPDATE SET "expiresAt"=excluded."expiresAt"`, [key, Math.max(1, Math.floor(ttlMs))]);
        }
        catch (e) {
            this.warnDbOnce(e);
            this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value: undefined });
        }
    }
    async dbSeenOrMark(key, ttlMs) {
        try {
            // 先清掉过期行，避免过期 key 的冲突被误判为「窗口内已存在」
            await this.raw().query(`DELETE FROM campus_dedupe_key WHERE "key"=$1 AND "expiresAt" <= now()`, [key]);
            const result = await this.raw().query(`INSERT INTO campus_dedupe_key ("key", "expiresAt", "counter")
                 VALUES ($1, now() + ($2::bigint * interval '1 millisecond'), 0)
                 ON CONFLICT ("key") DO NOTHING
                 RETURNING "key"`, [key, Math.max(1, Math.floor(ttlMs))]);
            // 抢占成功（有返回行）→ 不是重复；冲突（无返回行）→ 已存在
            return this.rows(result).length === 0;
        }
        catch (e) {
            this.warnDbOnce(e);
            const hit = this.memorySeen(key);
            if (!hit)
                this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value: undefined });
            return hit;
        }
    }
    async dbIncr(key, windowMs) {
        try {
            const result = await this.raw().query(`INSERT INTO campus_dedupe_key ("key", "expiresAt", "counter")
                 VALUES ($1, now() + ($2::bigint * interval '1 millisecond'), 1)
                 ON CONFLICT ("key") DO UPDATE SET
                     "counter" = CASE WHEN campus_dedupe_key."expiresAt" <= now()
                                      THEN 1 ELSE campus_dedupe_key."counter" + 1 END,
                     "expiresAt" = CASE WHEN campus_dedupe_key."expiresAt" <= now()
                                        THEN excluded."expiresAt" ELSE campus_dedupe_key."expiresAt" END
                 RETURNING "counter"`, [key, Math.max(1, Math.floor(windowMs))]);
            const row = this.rows(result)[0];
            return Number(row === null || row === void 0 ? void 0 : row.counter) || 1;
        }
        catch (e) {
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
    async dbSetJson(key, value, ttlMs) {
        try {
            await this.raw().query(`INSERT INTO campus_dedupe_key ("key", "expiresAt", "counter", "value")
                 VALUES ($1, now() + ($2::bigint * interval '1 millisecond'), 0, $3::jsonb)
                 ON CONFLICT ("key") DO UPDATE SET
                     "expiresAt"=excluded."expiresAt", "value"=excluded."value"`, [key, Math.max(1, Math.floor(ttlMs)), JSON.stringify(value !== null && value !== void 0 ? value : null)]);
        }
        catch (e) {
            this.warnDbOnce(e);
            this.memorySet(key, { expiresAt: Date.now() + ttlMs, counter: 0, value });
        }
    }
    async dbGetJson(key) {
        var _a;
        try {
            const result = await this.raw().query(`SELECT "value" FROM campus_dedupe_key WHERE "key"=$1 AND "expiresAt" > now()`, [key]);
            const row = this.rows(result)[0];
            if (!row)
                return null;
            const value = row.value;
            if (typeof value === 'string') {
                try {
                    return JSON.parse(value);
                }
                catch (_b) {
                    return null;
                }
            }
            return (value !== null && value !== void 0 ? value : null);
        }
        catch (e) {
            this.warnDbOnce(e);
            const cur = this.validMemory(key);
            return cur ? ((_a = cur.value) !== null && _a !== void 0 ? _a : null) : null;
        }
    }
    /** 首次失败记一次告警（后续静默，避免刷屏） */
    warnDbOnce(e) {
        var _a;
        if (this.dbBroken)
            return;
        this.dbBroken = true;
        core_1.Logger.warn(`去重表不可用（降级为进程内内存，跨实例冷却将失效）：${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, loggerCtx);
    }
    // ----------------------------------------------------------------- redis
    async withRedis(fn) {
        var _a;
        const client = await this.redisClient();
        if (!client)
            return undefined;
        try {
            return await fn(client);
        }
        catch (e) {
            this.redisBroken = true;
            core_1.Logger.warn(`redis 去重后端失败（回退 db）：${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, loggerCtx);
            return undefined;
        }
    }
    async redisClient() {
        if (this.redisBroken)
            return null;
        if (this.redis)
            return this.redis;
        if (!this.redisLoading) {
            this.redisLoading = (async () => {
                var _a, _b;
                try {
                    // 动态加载：未安装 redis 包时不阻塞插件启动
                    const mod = require('redis');
                    const client = mod.createClient({ url: process.env.CAMPUS_REDIS_URL || 'redis://127.0.0.1:6379' });
                    (_a = client.on) === null || _a === void 0 ? void 0 : _a.call(client, 'error', (e) => { var _a; return core_1.Logger.warn(`redis 连接错误：${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, loggerCtx); });
                    await client.connect();
                    this.redis = client;
                    return client;
                }
                catch (e) {
                    this.redisBroken = true;
                    core_1.Logger.warn(`redis 不可用（回退 db）：${String((_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e)}；如需启用请安装 redis 并配置 CAMPUS_REDIS_URL`, loggerCtx);
                    return null;
                }
            })();
        }
        return this.redisLoading;
    }
    // --------------------------------------------------------------- cleanup
    async cleanupOnce() {
        if (this.driver === 'memory') {
            const now = Date.now();
            for (const [key, entry] of this.memory) {
                if (entry.expiresAt <= now)
                    this.memory.delete(key);
            }
            return;
        }
        try {
            await this.raw().query(`DELETE FROM campus_dedupe_key WHERE "expiresAt" <= now()`);
        }
        catch (e) {
            this.warnDbOnce(e);
        }
    }
};
exports.CampusDedupeService = CampusDedupeService;
exports.CampusDedupeService = CampusDedupeService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], CampusDedupeService);
//# sourceMappingURL=campus-dedupe.service.js.map