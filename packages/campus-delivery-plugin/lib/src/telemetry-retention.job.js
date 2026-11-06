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
exports.TelemetryRetentionJob = exports.TELEMETRY_RETENTION_DAYS = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const periodic_fallback_1 = require("./periodic-fallback");
const loggerCtx = 'CampusTelemetryRetention';
/** 首跑延迟：等迁移/DB 就绪，避免与应用启动争抢锁 */
const BOOT_DELAY_MS = 5 * 60000;
/** 每日一轮即可（清理与埋点写入是同一批表，低频更稳） */
const INTERVAL_MS = 24 * 3600000;
/**
 * 埋点/错误报告保留天数：后台趋势只用 7 日、排障与售后追溯保留 90 天足够，
 * 避免匿名上报长期累积（M2 的日上限只限增量，不限制存量）。
 */
exports.TELEMETRY_RETENTION_DAYS = 90;
/** 分批删除，避免一次大 DELETE 长时间持锁影响埋点写入 */
const DELETE_CHUNK = 5000;
/** 单表单轮最多删除 100 万行，超出部分下一轮继续（防止异常数据把一轮拖死） */
const MAX_CHUNKS = 200;
const TABLES = ['campus_track_event', 'campus_error_report'];
/**
 * 埋点/错误报告过期清理（保留 TELEMETRY_RETENTION_DAYS 天）。
 * - 只按 createdAt 删除，保留统计口径不受影响（趋势只看 7 日）。
 * - 幂等：多实例并发执行只会重复删除同一批旧行，无副作用。
 * - 分批 + 每轮计数日志，便于观察存量收敛。
 */
let TelemetryRetentionJob = class TelemetryRetentionJob {
    constructor(connection) {
        this.connection = connection;
        this.fallback = null;
    }
    start() {
        if (this.fallback)
            return;
        this.fallback = new periodic_fallback_1.PeriodicFallback({
            name: 'telemetry-retention',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() => this.run());
    }
    stop() {
        var _a;
        (_a = this.fallback) === null || _a === void 0 ? void 0 : _a.stop();
        this.fallback = null;
    }
    async run() {
        const cutoff = new Date(Date.now() - exports.TELEMETRY_RETENTION_DAYS * 24 * 3600000);
        for (const table of TABLES) {
            try {
                const deleted = await this.purge(table, cutoff);
                if (deleted > 0) {
                    core_1.Logger.info(`清理 ${table} 过期数据 ${deleted} 行（早于 ${cutoff.toISOString()}）`, loggerCtx);
                }
            }
            catch (e) {
                core_1.Logger.error(`清理 ${table} 失败: ${e === null || e === void 0 ? void 0 : e.message}`, loggerCtx);
            }
        }
    }
    async purge(table, cutoff) {
        var _a;
        if (!TABLES.includes(table))
            throw new Error(`unexpected table ${table}`);
        let total = 0;
        for (let i = 0; i < MAX_CHUNKS; i++) {
            const raw = await this.connection.rawConnection.query(`DELETE FROM ${table} WHERE id IN (`
                + ` SELECT id FROM ${table} WHERE "createdAt" < $1 ORDER BY id LIMIT ${DELETE_CHUNK}`
                + ` ) RETURNING id`, [cutoff]);
            const rows = Array.isArray(raw) ? raw : ((_a = raw === null || raw === void 0 ? void 0 : raw.rows) !== null && _a !== void 0 ? _a : []);
            total += rows.length;
            if (!rows.length)
                break;
        }
        return total;
    }
};
exports.TelemetryRetentionJob = TelemetryRetentionJob;
exports.TelemetryRetentionJob = TelemetryRetentionJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection])
], TelemetryRetentionJob);
//# sourceMappingURL=telemetry-retention.job.js.map