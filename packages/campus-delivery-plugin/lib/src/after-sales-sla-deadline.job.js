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
exports.AfterSalesSlaDeadlineJob = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@vendure/core");
const after_sales_sla_1 = require("./after-sales-sla");
const closure_calendar_1 = require("./closure-calendar");
const advisory_lock_1 = require("./advisory-lock");
const campus_config_service_1 = require("./campus-config.service");
const periodic_fallback_1 = require("./periodic-fallback");
const loggerCtx = 'CampusAfterSalesSla';
/** 启动后首跑延迟：等迁移补 slaDeadlineAt 列 */
const BOOT_DELAY_MS = 60000;
/** 重算周期：5 分钟，新售后单最迟 5 分钟内纳入营业时段口径 */
const INTERVAL_MS = 5 * 60000;
/**
 * 售后 SLA 截止时间重算（§99）：把「申请时间 + 处理时限」换算成营业时段感知的截止时间，
 * 写入 after_sales_request.slaDeadlineAt，供列表筛选、工作台统计、处理人负载、报表统一使用。
 * - 未配置营业时间（或配置无法解析）时等价于申请时间 + 时限 + 暂停累计。
 * - 重算本身幂等，但多实例同跑会放大读写压力并重复读渠道配置，故仍以咨询锁串行化。
 */
let AfterSalesSlaDeadlineJob = class AfterSalesSlaDeadlineJob {
    constructor(connection, config) {
        this.connection = connection;
        this.config = config;
        this.fallback = null;
    }
    start() {
        if (this.fallback)
            return;
        this.fallback = new periodic_fallback_1.PeriodicFallback({
            name: 'after-sales-sla-deadline',
            intervalMs: INTERVAL_MS,
            bootDelayMs: BOOT_DELAY_MS,
            loggerCtx,
        });
        this.fallback.start(() => 
        // 多实例互斥：拿不到锁说明其他实例正在重算，本轮直接跳过
        (0, advisory_lock_1.withAdvisoryLock)(this.connection, 'campus:after-sales-sla-deadline', () => this.run()));
    }
    stop() {
        var _a;
        (_a = this.fallback) === null || _a === void 0 ? void 0 : _a.stop();
        this.fallback = null;
    }
    onApplicationShutdown() {
        this.stop();
    }
    async run() {
        var _a, _b;
        let channels;
        try {
            channels = await this.connection.rawConnection.getRepository(core_1.Channel).find();
        }
        catch (e) {
            core_1.Logger.warn(`query channels failed: ${String((_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e)}`, loggerCtx);
            return;
        }
        for (const channel of channels) {
            try {
                await this.runChannel(channel);
            }
            catch (e) {
                core_1.Logger.warn(`sla deadline failed for channel ${channel.code}: ${String((_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e)}`, loggerCtx);
            }
        }
    }
    async runChannel(channel) {
        var _a, _b, _c, _d, _e;
        const cf = ((_a = channel.customFields) !== null && _a !== void 0 ? _a : {});
        const businessHours = (_b = cf.waimaiBusinessHours) !== null && _b !== void 0 ? _b : null;
        const timeoutHours = Number((_c = cf.afterSalesTimeoutHours) !== null && _c !== void 0 ? _c : 48);
        // §100：休业日整天不计入处理时限（含历史休业日，供跨假期工单按同一口径重算）
        const ctx = new core_1.RequestContext({ apiType: 'admin', channel, isAuthorized: true, authorizedAsOwnerOnly: false });
        let closureDates = [];
        try {
            closureDates = (0, closure_calendar_1.closureDateKeys)((_d = (await this.config.getConfig(ctx))) === null || _d === void 0 ? void 0 : _d.closureDates);
        }
        catch (e) {
            core_1.Logger.warn(`read closure dates failed for channel ${channel.code}: ${String((_e = e === null || e === void 0 ? void 0 : e.message) !== null && _e !== void 0 ? _e : e)}`, loggerCtx);
        }
        const raw = this.connection.rawConnection;
        const rows = await raw.query(`SELECT a.id, a."createdAt", COALESCE(a."slaPausedMs", 0) AS paused
               FROM after_sales_request a
              WHERE a.state IN ('Pending', 'Appealed')
                AND EXISTS (SELECT 1 FROM "order" o
                            JOIN order_channels_channel oc ON oc."orderId" = o.id
                            WHERE o.id = a."orderId" AND oc."channelId" = $1)`, [Number(channel.id)]);
        const list = Array.isArray(rows) && Array.isArray(rows[0]) ? rows[0] : rows;
        if (!Array.isArray(list) || !list.length)
            return;
        for (const r of list) {
            const deadline = (0, after_sales_sla_1.businessDeadline)(new Date(r.createdAt), timeoutHours, businessHours, Number(r.paused), closureDates);
            await raw.query('UPDATE after_sales_request SET "slaDeadlineAt" = to_timestamp($2 / 1000.0) '
                + 'WHERE id = $1 AND "slaDeadlineAt" IS DISTINCT FROM to_timestamp($2 / 1000.0)', [Number(r.id), deadline]);
        }
    }
};
exports.AfterSalesSlaDeadlineJob = AfterSalesSlaDeadlineJob;
exports.AfterSalesSlaDeadlineJob = AfterSalesSlaDeadlineJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection, campus_config_service_1.CampusConfigService])
], AfterSalesSlaDeadlineJob);
//# sourceMappingURL=after-sales-sla-deadline.job.js.map